"""Read-only U校园AI unit and resource status, adapted from GPL-3.0 UnipusAI.

Source: Zzj-klwgxdz/UnipusAI src/api/course.rs and session.rs,
commit 937725ede225f63e7746f11c0ff6ac297e524909.
The endpoint shapes are upstream implementation evidence, not a successful
StudyFlow account integration or a license to infer unseen completions.
"""
from __future__ import annotations

import base64
import json
import re
from typing import Any, TYPE_CHECKING
from urllib.parse import quote

import requests

if TYPE_CHECKING:
    from .credentials import UCampusConfig

CONTENT_ORIGIN = "https://ucontent.unipus.cn"
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class UCampusProgressError(RuntimeError):
    pass


def _identifier(value: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise UCampusProgressError("INVALID_REQUEST")
    return value


def _jwt_open_id(config: UCampusConfig) -> str:
    """Read only the openId claim, never trust it as proof of authentication."""
    cookie_fields = dict(part.strip().split("=", 1) for part in config.cookie.split(";") if "=" in part)
    token = cookie_fields.get("jwt") or config.authorization.removeprefix("Bearer ").strip()
    try:
        fragment = token.split(".")[1]
        if len(fragment) > 8192:
            raise ValueError
        data = base64.urlsafe_b64decode(fragment + "=" * (-len(fragment) % 4))
        if len(data) > 4096:
            raise ValueError
        parsed = json.loads(data)
        return _identifier(parsed.get("openId", ""))
    except (AttributeError, IndexError, ValueError, TypeError, json.JSONDecodeError):
        raise UCampusProgressError("UCAMPUS_OPEN_ID_REQUIRED") from None


def _headers(config: UCampusConfig, open_id: str) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Cookie": config.cookie,
        "u-openid": open_id,
        "x-csrftoken": open_id,
        "u-app-id": "39",
        "u-platform": "2",
        "Origin": CONTENT_ORIGIN,
        "Referer": CONTENT_ORIGIN + "/_explorationpc_default/pc.html",
    }
    token = config.authorization or dict(part.strip().split("=", 1)
              for part in config.cookie.split(";") if "=" in part).get("jwt", "")
    if token:
        headers["Authorization"] = token
    return headers


def _request(url: str, config: UCampusConfig, open_id: str) -> dict[str, Any]:
    try:
        # Fixed first-party HTTPS host; no server-returned URLs, no redirects.
        response = requests.get(url, headers=_headers(config, open_id),
                                timeout=(5, 12), allow_redirects=False)
        if response.status_code in (401, 403):
            raise UCampusProgressError("UCAMPUS_SESSION_EXPIRED")
        if response.status_code != 200 or response.is_redirect:
            raise UCampusProgressError("UCAMPUS_PROGRESS_UNAVAILABLE")
        if len(response.content) > 2_000_000 or "json" not in response.headers.get("content-type", "").lower():
            raise UCampusProgressError("UCAMPUS_PROGRESS_FORMAT_UNVERIFIED")
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("rt"), dict):
            raise UCampusProgressError("UCAMPUS_PROGRESS_FORMAT_UNVERIFIED")
        return payload["rt"]
    except (requests.RequestException, ValueError) as exc:
        raise UCampusProgressError("UCAMPUS_PROGRESS_UNAVAILABLE") from exc


def parse_units(rt: dict[str, Any]) -> list[dict[str, Any]]:
    """The upstream course-progress map reports unit keys, not human labels."""
    if not isinstance(rt, dict) or not isinstance(rt.get("units"), dict):
        raise UCampusProgressError("UCAMPUS_PROGRESS_FORMAT_UNVERIFIED")
    units = rt["units"]
    if len(units) > 500:
        raise UCampusProgressError("UCAMPUS_PROGRESS_FORMAT_UNVERIFIED")
    result = []
    for unit_id in sorted(units):
        if not _ID.fullmatch(unit_id):
            continue
        # Unit-level server status is not established by the mere presence of a unit.
        result.append({"id": unit_id, "title": "", "completed": None})
    return result


def parse_tasks(rt: dict[str, Any], unit_id: str) -> list[dict[str, Any]]:
    """Only leaf.state.pass>=1 is an affirmative server task completion."""
    if not isinstance(rt, dict) or not isinstance(rt.get("leafs"), dict):
        raise UCampusProgressError("UCAMPUS_PROGRESS_FORMAT_UNVERIFIED")
    leaves = rt["leafs"]
    if len(leaves) > 1000:
        raise UCampusProgressError("UCAMPUS_PROGRESS_FORMAT_UNVERIFIED")
    result = []
    for resource_id in sorted(leaves):
        leaf = leaves[resource_id]
        if not _ID.fullmatch(resource_id) or not isinstance(leaf, dict):
            continue
        strategies = leaf.get("strategies")
        state = leaf.get("state")
        required = strategies.get("required") if isinstance(strategies, dict) else None
        passed = state.get("pass") if isinstance(state, dict) else None
        if passed is True or passed == 1 or isinstance(passed, (int, float)) and passed > 1:
            completed = True
        elif passed in (0, "0") and passed is not None:
            completed = False
        else:
            completed = None
        result.append({
            "id": resource_id,
            "unit_id": unit_id,
            "title": "",
            "type": (str(leaf.get("tab_type") or "unknown")[:32]),
            "required": required if type(required) is bool else None,
            "completed": completed,
        })
    return result


class UCampusProgressReader:
    def __init__(self, credentials_loader=None):
        from . import credentials
        self._load = credentials_loader or credentials.load

    def _session(self):
        config = self._load()
        if config is None:
            raise UCampusProgressError("UCAMPUS_SESSION_MISSING")
        if config.variant != "ai":
            raise UCampusProgressError("UCAMPUS_AI_ONLY")
        return config, _jwt_open_id(config)

    def list_units(self, course_id: str) -> list[dict[str, Any]]:
        course = _identifier(course_id)
        config, open_id = self._session()
        url = f"{CONTENT_ORIGIN}/course/api/v2/course_progress/{quote(course, safe='')}/{quote(open_id, safe='')}/default"
        return parse_units(_request(url, config, open_id))

    def list_tasks(self, course_id: str, unit_id: str) -> list[dict[str, Any]]:
        course = _identifier(course_id)
        unit = _identifier(unit_id)
        config, open_id = self._session()
        url = (f"{CONTENT_ORIGIN}/course/api/v2/course_progress/{quote(course, safe='')}/"
               f"{quote(unit, safe='')}/{quote(open_id, safe='')}/default/")
        return parse_tasks(_request(url, config, open_id), unit)
