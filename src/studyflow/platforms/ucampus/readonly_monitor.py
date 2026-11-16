"""Opt-in, read-only U校园 progress verification with restart recovery.

Only a bounded course/unit checkpoint and SHA-256 session marker are persisted.
Never stores cookies, passwords, JWTs, media events or fabricated watch time.
The host app calls tick on launch and at a conservative interval while open.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import credentials
from .course_progress import UCampusProgressReader, UCampusProgressError, _identifier

_LOCK = threading.RLock()
_MIN_INTERVAL_SECONDS = 60
_FILENAME = "ucampus_readonly_monitor_v1.json"
_ALLOWED_STATUS = frozenset((
    "pending", "verified", "UCAMPUS_SESSION_MISSING", "UCAMPUS_SESSION_EXPIRED",
    "UCAMPUS_PROGRESS_UNAVAILABLE", "UCAMPUS_PROGRESS_FORMAT_UNVERIFIED",
    "UCAMPUS_OPEN_ID_REQUIRED", "UCAMPUS_AI_ONLY", "account_changed",
))


class UCampusMonitorError(RuntimeError):
    """Only stable, credential-safe public codes."""


def _path() -> Path:
    root = os.environ.get("LOCALAPPDATA")
    return Path(root) / "StudyFlow" / _FILENAME if root else Path.home() / ".studyflow" / _FILENAME


def _session_marker() -> str | None:
    config = credentials.load()
    if config is None or config.variant != "ai":
        return None
    return hashlib.sha256(("StudyFlow.UCampus.readonly.v1|" + config.cookie).encode()).hexdigest()


def _load() -> dict[str, Any] | None:
    path = _path()
    try:
        if not path.is_file() or path.stat().st_size > 4096:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        if (not isinstance(data, dict) or data.get("version") != 1
                or data.get("enabled") is not True
                or not isinstance(data.get("course_id"), str)
                or not isinstance(data.get("unit_id"), str)
                or not isinstance(data.get("session_marker"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", data["session_marker"])):
            return None
        _identifier(data["course_id"])
        _identifier(data["unit_id"])
        return data
    except (OSError, ValueError, TypeError, UnicodeError, UCampusProgressError):
        return None


def _write(data: dict[str, Any] | None) -> None:
    path = _path()
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    except OSError as exc:
        raise UCampusMonitorError("UCAMPUS_MONITOR_STORAGE_FAILED") from exc
    if data is None:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            raise UCampusMonitorError("UCAMPUS_MONITOR_STORAGE_FAILED") from exc
        return
    name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, prefix=".ucampus-",
            suffix=".tmp", delete=False,
        ) as handle:
            name = handle.name
            os.chmod(name, 0o600)
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        os.replace(name, path)
    except OSError as exc:
        raise UCampusMonitorError("UCAMPUS_MONITOR_STORAGE_FAILED") from exc
    finally:
        if name:
            try:
                os.unlink(name)
            except FileNotFoundError:
                pass
            except OSError:
                pass  # Never leak the temporary path or mask an earlier error.


def _public(data: dict[str, Any] | None) -> dict[str, Any]:
    if data is None:
        return {"enabled": False, "course_id": "", "unit_id": "",
                "state": "disabled", "checked_at": "", "total": 0,
                "passed": 0, "unknown": 0}
    marker = _session_marker()
    if marker is None or marker != data["session_marker"]:
        # Never expose a previous account's course status after account switch.
        return {"enabled": False, "course_id": "", "unit_id": "",
                "state": "account_changed", "checked_at": "", "total": 0,
                "passed": 0, "unknown": 0}
    state = data.get("state")
    if not isinstance(state, str) or state not in _ALLOWED_STATUS:
        state = "pending"
    checked_at = data.get("checked_at")
    if not isinstance(checked_at, str) or len(checked_at) > 48:
        checked_at = ""
    def count(field: str) -> int:
        value = data.get(field)
        return value if type(value) is int and 0 <= value <= 100000 else 0
    return {"enabled": True, "course_id": data["course_id"], "unit_id": data["unit_id"],
            "state": state, "checked_at": checked_at,
            "total": count("total"), "passed": count("passed"),
            "unknown": count("unknown")}


def status() -> dict[str, Any]:
    with _LOCK:
        return _public(_load())


def configure(course_id: str, unit_id: str, enabled: bool) -> dict[str, Any]:
    if type(enabled) is not bool:
        raise UCampusMonitorError("INVALID_REQUEST")
    with _LOCK:
        if not enabled:
            _write(None)
            return _public(None)
        try:
            course, unit = _identifier(course_id), _identifier(unit_id)
        except UCampusProgressError as exc:
            raise UCampusMonitorError("INVALID_REQUEST") from exc
        marker = _session_marker()
        if marker is None:
            raise UCampusMonitorError("UCAMPUS_SESSION_MISSING")
        _write({"version": 1, "enabled": True, "course_id": course, "unit_id": unit,
                "session_marker": marker, "state": "pending",
                "checked_at": "", "last_attempt": 0, "total": 0, "passed": 0,
                "unknown": 0})
        return _public(_load())


def tick(*, clock=None, reader_factory=UCampusProgressReader) -> dict[str, Any]:
    """One bounded read-only GET, no media event, POST, or automatic replay."""
    with _LOCK:
        saved = _load()
        public = _public(saved)
        if not public["enabled"] or saved is None:
            return public
        now = float(clock() if clock else time.time())
        previous_attempt = saved.get("last_attempt", 0)
        if (type(previous_attempt) not in (int, float)
                or previous_attempt < 0 or not float(previous_attempt) < float("inf")):
            previous_attempt = 0
        if now - float(previous_attempt) < _MIN_INTERVAL_SECONDS:
            return public
        saved["last_attempt"] = now
        _write(saved)  # persist attempt before GET to avoid restart request storms
        try:
            tasks = reader_factory().list_tasks(saved["course_id"], saved["unit_id"])
            if not isinstance(tasks, list):
                raise UCampusProgressError("UCAMPUS_PROGRESS_FORMAT_UNVERIFIED")
            saved.update(
                state="verified",
                checked_at=datetime.fromtimestamp(now, timezone.utc).isoformat(),
                total=len(tasks),
                passed=sum(task.get("completed") is True for task in tasks),
                unknown=sum(task.get("completed") is None for task in tasks),
            )
        except UCampusProgressError as exc:
            code = str(exc)
            saved["state"] = code if code in _ALLOWED_STATUS else "UCAMPUS_PROGRESS_UNAVAILABLE"
        except Exception:
            saved["state"] = "UCAMPUS_PROGRESS_UNAVAILABLE"
        _write(saved)
        return _public(saved)
