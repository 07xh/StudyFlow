"""Conservative U校园 course catalog reading without invented endpoints.

Until a representative authenticated catalog GET is verified, no prefilled URL
or pretend list is used. Never expose credentials or server response bodies.
"""
from __future__ import annotations

from typing import Any
import requests

from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo
from . import credentials


class UCampusCatalogError(RuntimeError):
    pass


def _text(row: dict, keys: tuple[str, ...], limit: int) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:limit]
        if type(value) is int and value >= 0:
            return str(value)
    return ""


def parse_catalog(payload: Any) -> list[Course]:
    """Only a recognized JSON list carrying actual course IDs and names counts."""
    if isinstance(payload, dict) and (payload.get("success") is False or
                                      payload.get("code") in (401, 403, "401", "403")):
        raise UCampusCatalogError("UCAMPUS_SESSION_EXPIRED")
    for _ in range(4):
        if isinstance(payload, list):
            break
        if not isinstance(payload, dict):
            raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
        payload = next((payload[key] for key in ("courses", "courseList", "list", "rows", "items", "data", "result")
                        if isinstance(payload.get(key), (dict, list))), None)
    if not isinstance(payload, list) or len(payload) > 500:
        raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
    seen: set[str] = set()
    courses: list[Course] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        course_id = _text(row, ("courseId", "course_id", "courseID", "id"), 128)
        name = _text(row, ("courseName", "course_name", "name", "title"), 200)
        if course_id and name and course_id not in seen:
            seen.add(course_id)
            # The server's actual progress schema has not yet been verified.
            courses.append(Course(platform=Platform.UCAMPUS, course_id=course_id, title=name))
    if payload and not courses:
        raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
    return courses


class UCampusAdapter:
    def connection_info(self) -> ConnectionInfo:
        if credentials.load() is None:
            return ConnectionInfo(Platform.UCAMPUS, False, "未配置 U校园真实课程接口和登录会话")
        try:
            self.list_courses()
            return ConnectionInfo(Platform.UCAMPUS, True, "U校园课程接口验证通过")
        except Exception:
            return ConnectionInfo(Platform.UCAMPUS, False, "会话失效、接口未核验或网络不可用")

    def list_courses(self) -> list[Course]:
        config = credentials.load()
        if config is None:
            raise UCampusCatalogError("UCAMPUS_SESSION_MISSING")
        headers = {"Accept": "application/json", "Cookie": config.cookie,
                   "User-Agent": "StudyFlow UCampus read-only client"}
        if config.authorization:
            headers["Authorization"] = config.authorization
        try:
            # Refuse redirects to avoid leaking credentials across hosts.
            response = requests.get(config.catalog_url, headers=headers,
                                    timeout=(5, 12), allow_redirects=False)
            if response.status_code in (401, 403):
                raise UCampusCatalogError("UCAMPUS_SESSION_EXPIRED")
            if response.status_code != 200 or response.is_redirect:
                raise UCampusCatalogError("UCAMPUS_CATALOG_UNAVAILABLE")
            if len(response.content) > 2_000_000 or "json" not in response.headers.get("content-type", "").lower():
                raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
            return parse_catalog(response.json())
        except (requests.RequestException, ValueError) as exc:
            raise UCampusCatalogError("UCAMPUS_CATALOG_UNAVAILABLE") from exc
