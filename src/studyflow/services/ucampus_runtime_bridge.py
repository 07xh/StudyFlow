"""Persistent local-only heartbeat runtime for U校园 course task IDs.

The production sender intentionally remains unregistered until its protocol is
verified. Local heartbeat events are generated without an official media player,
but sent=0 and server_confirmed=None until an authorized sender is integrated.
"""
from __future__ import annotations

import atexit
import threading
from typing import Any

from studyflow.platforms.ucampus.course_progress import UCampusProgressReader, UCampusProgressError
from studyflow.platforms.ucampus.local_runtime import MediaTask, UCampusLocalRunner

_OPERATIONS = frozenset({
    "ucampus.heartbeat.capabilities", "ucampus.heartbeat.start",
    "ucampus.heartbeat.status", "ucampus.heartbeat.pause",
    "ucampus.heartbeat.resume", "ucampus.heartbeat.stop",
})
_LOCK = threading.Lock()
_RUNNER: UCampusLocalRunner | None = None


def get_runner() -> UCampusLocalRunner:
    global _RUNNER
    with _LOCK:
        if _RUNNER is None:
            _RUNNER = UCampusLocalRunner(interval=2.0)
        return _RUNNER


def dispatch(operation: str, request: dict[str, Any]) -> dict[str, Any] | None:
    if operation not in _OPERATIONS:
        return None
    if operation == "ucampus.heartbeat.capabilities":
        return {"ok": True, "local_generation": True,
                "sender_connected": False, "server_verified": False,
                "message": "本地心跳生成已接入；U校园平台发送协议未验证"}
    runner = get_runner()
    if operation == "ucampus.heartbeat.stop" and request.get("graceful") is True:
        runner.shutdown()
        return {"ok": True, "stopped": True}
    course_id = request.get("course_id")
    if not isinstance(course_id, str) or not 1 <= len(course_id) <= 128:
        return {"ok": False, "error": "UCAMPUS_COURSE_REQUIRED"}
    if operation == "ucampus.heartbeat.status":
        return {"ok": True, **runner.status(course_id)}
    if operation == "ucampus.heartbeat.start":
        unit_id = request.get("unit_id")
        pulses = request.get("pulses", 5)
        if (not isinstance(unit_id, str) or not 1 <= len(unit_id) <= 128
                or type(pulses) is not int or not 1 <= pulses <= 100):
            return {"ok": False, "error": "UCAMPUS_INVALID_PARAMETER"}
        try:
            rows = UCampusProgressReader().list_tasks(course_id, unit_id)
            tasks = [
                MediaTask(course_id, unit_id, item["id"], item["title"] or item["id"])
                for item in rows
                if item["type"].lower() in ("video", "audio") and item["completed"] is not True
            ]
            if not tasks:
                return {"ok": False, "error": "UCAMPUS_NO_MEDIA_TASKS"}
            # This is a LOCAL tick run only: no request gets sent to U校园.
            return {"ok": True, **runner.start(
                course_id, tasks, transport=None, concurrency=1,
                pulses_per_resource=pulses)}
        except UCampusProgressError as exc:
            return {"ok": False, "error": str(exc)}
        except (ValueError, RuntimeError) as exc:
            return {"ok": False, "error": str(exc)}
        except Exception:
            return {"ok": False, "error": "UCAMPUS_RUNTIME_UNAVAILABLE"}
    run_id = request.get("run_id")
    if runner.status(course_id).get("run_id") != run_id:
        return {"ok": False, "error": "UCAMPUS_RUN_ID_MISMATCH"}
    if not isinstance(run_id, str) or len(run_id) != 32 or not all(x in "0123456789abcdef" for x in run_id):
        return {"ok": False, "error": "UCAMPUS_RUN_ID_MISMATCH"}
    try:
        result = runner.control(operation.rsplit(".", 1)[-1], run_id)
        if result.get("course_id") != course_id:
            return {"ok": False, "error": "UCAMPUS_RUN_ID_MISMATCH"}
        return {"ok": True, **result}
    except (ValueError, RuntimeError) as exc:
        return {"ok": False, "error": str(exc)}


def reset_runner() -> None:
    """Stop and release the previous account's local task state."""
    global _RUNNER
    with _LOCK:
        runner = _RUNNER
        _RUNNER = None
    if runner is not None:
        runner.shutdown()


def shutdown() -> None:
    with _LOCK:
        runner = _RUNNER
    if runner is not None:
        runner.shutdown()


atexit.register(shutdown)
