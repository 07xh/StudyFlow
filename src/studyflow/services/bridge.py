"""Versioned JSON-lines IPC for a future Tauri sidecar.

Only read-only status and course-model validation are exposed. No credentials,
raw exceptions, cookies or upstream API payloads are emitted.
"""
from __future__ import annotations

import json
import sys
from typing import Any

from studyflow.core.models import Platform
from studyflow.platforms.zhidao.adapter import ZhidaoAdapter
from studyflow.platforms.yuketang.adapter import YuketangAdapter

MAX_LINE = 65536
ADAPTERS = {"zhidao": ZhidaoAdapter(), "yuketang": YuketangAdapter()}


def dispatch(request: dict[str, Any]) -> dict[str, Any]:
    request_id = request.get("id")
    if not isinstance(request_id, str) or len(request_id) > 128:
        return {"id": None, "ok": False, "error": "INVALID_REQUEST"}
    if request.get("version") != 1:
        return {"id": request_id, "ok": False, "error": "UNSUPPORTED_VERSION"}
    operation = request.get("operation")
    if operation == "ping":
        return {"id": request_id, "ok": True, "data": {"version": 1, "service": "studyflow"}}
    if operation == "platform.status":
        return {"id": request_id, "ok": True, "data": [
            {"platform": k, "connected": (info := a.connection_info()).connected, "message": info.message}
            for k, a in ADAPTERS.items()
        ]}
    if operation == "courses.list":
        platform = request.get("platform")
        if not isinstance(platform, str) or platform not in ADAPTERS:
            return {"id": request_id, "ok": False, "error": "UNKNOWN_PLATFORM"}
        try:
            courses = ADAPTERS[platform].list_courses()
        except Exception:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
        return {"id": request_id, "ok": True, "data": [
            {"platform": c.platform.value, "course_id": c.course_id, "title": c.title,
             "progress_percent": c.progress_percent, "course_type": c.course_type,
             "stale": c.stale, "progress_evidence": None, "verified_at": None}
            for c in courses
        ]}
    return {"id": request_id, "ok": False, "error": "UNKNOWN_OPERATION"}


def main() -> int:
    for raw in sys.stdin.buffer:
        try:
            if len(raw) > MAX_LINE:
                raise ValueError("oversized")
            req = json.loads(raw)
            if not isinstance(req, dict):
                raise ValueError("invalid")
            result = dispatch(req)
        except (ValueError, UnicodeDecodeError, TypeError):
            result = {"id": None, "ok": False, "error": "INVALID_REQUEST"}
        sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
