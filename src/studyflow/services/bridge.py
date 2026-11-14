"""Versioned JSON-lines local IPC for the packaged Tauri sidecar.

Errors have fixed public codes. Private credentials, raw server payloads and
identifiers never appear in logs or error output.
"""
from __future__ import annotations

import atexit
import json
import sys
from typing import Any

from studyflow.platforms.zhidao.adapter import ZhidaoAdapter
from studyflow.platforms.zhidao import qr_runtime
from studyflow.platforms.zhidao.cookie_import import import_cookie

# Best-effort cleanup when the persistent JSONL process reaches normal EOF.
atexit.register(qr_runtime.cancel)
from studyflow.platforms.yuketang.adapter import YuketangAdapter
from studyflow.platforms.yuketang import credentials
from studyflow.platforms.yuketang.legacy_config import read_settings as get_original_ykt_settings, save_settings as save_original_ykt_settings

MAX_LINE = 600000
ADAPTERS = {"zhidao": ZhidaoAdapter(), "yuketang": YuketangAdapter()}


def dispatch(request: dict[str, Any]) -> dict[str, Any]:
    request_id = request.get("id")
    if not isinstance(request_id, str) or not 0 < len(request_id) <= 128:
        return {"id": None, "ok": False, "error": "INVALID_REQUEST"}
    if request.get("version") != 1:
        return {"id": request_id, "ok": False, "error": "UNSUPPORTED_VERSION"}
    operation = request.get("operation")
    if operation == "ping":
        return {"id": request_id, "ok": True, "data": {"version": 1, "service": "studyflow"}}
    if operation in ("zhidao.qr.start", "zhidao.qr.status", "zhidao.qr.cancel"):
        try:
            if operation == "zhidao.qr.start":
                data = qr_runtime.start()
            elif operation == "zhidao.qr.cancel":
                data = qr_runtime.cancel()
            else:
                data = qr_runtime.status()
            return {"id": request_id, "ok": True, "data": data}
        except Exception:
            return {"id": request_id, "ok": False, "error": "ZHIDAO_QR_UNAVAILABLE"}
    if operation == "zhidao.cookie.import":
        try:
            data = import_cookie(request.get("content"), request.get("mode"))
            return {"id": request_id, "ok": True, "data": data}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_COOKIE_IMPORT"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "COOKIE_IMPORT_FAILED"}
    if operation == "platform.status":
        result = []
        for name, adapter in ADAPTERS.items():
            try:
                info = adapter.connection_info()
                result.append({"platform": name, "connected": info.connected, "message": info.message})
            except Exception:
                result.append({"platform": name, "connected": False, "message": "平台状态检测失败"})
        return {"id": request_id, "ok": True, "data": result}
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
    if operation == "videos.list":
        if request.get("platform") != "yuketang":
            return {"id": request_id, "ok": False, "error": "UNKNOWN_PLATFORM"}
        try:
            return {"id": request_id, "ok": True, "data": ADAPTERS["yuketang"].list_videos()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "PLATFORM_NOT_READY"}
    if operation == "yuketang.settings.get":
        try:
            return {"id": request_id, "ok": True, "data": get_original_ykt_settings()}
        except Exception:
            return {"id": request_id, "ok": False, "error": "YUKETANG_SETTINGS_UNAVAILABLE"}
    if operation == "yuketang.settings.save":
        try:
            data = save_original_ykt_settings(request.get("settings"))
            return {"id": request_id, "ok": True, "data": data}
        except ValueError:
            return {"id": request_id, "ok": False, "error": "INVALID_YUKETANG_SETTINGS"}
        except Exception:
            return {"id": request_id, "ok": False, "error": "YUKETANG_SETTINGS_UNAVAILABLE"}
    if operation == "yuketang.configure":
        try:
            credentials.save(request.get("configuration"))
            return {"id": request_id, "ok": True, "data": {"saved": True}}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CREDENTIAL_STORAGE_FAILED"}
    if operation == "yuketang.clear":
        try:
            credentials.clear()
            return {"id": request_id, "ok": True, "data": {"cleared": True}}
        except Exception:
            return {"id": request_id, "ok": False, "error": "CREDENTIAL_STORAGE_FAILED"}
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
