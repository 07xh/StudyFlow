"""IPC service for StudyFlow's fabricated U校园 completion heartbeats.

Runs inside the same long-lived JSONL sidecar as the other platform services;
no second process and no official player. All ids are validated, credentials
never appear in replies, and server completion is reported separately from
locally generated heartbeats.
"""
from __future__ import annotations

import atexit
import threading
from typing import Any

from studyflow.platforms.ucampus import credentials as ucampus_credentials
from studyflow.platforms.ucampus import fabricated_heartbeat as fh
from studyflow.platforms.ucampus.course_progress import (
    UCampusProgressError, UCampusProgressReader, _jwt_open_id,
)
from studyflow.platforms.ucampus.fabricated_runner import (
    FabricatedRunError, FabricatedRunner,
)
from studyflow.platforms.ucampus.fabricated_transport import FabricatedTransport

_OPERATIONS = frozenset({
    "ucampus.fabricated.capabilities", "ucampus.fabricated.start",
    "ucampus.fabricated.status", "ucampus.fabricated.pause",
    "ucampus.fabricated.resume", "ucampus.fabricated.stop",
    "ucampus.fabricated.history",
})
_LOCK = threading.Lock()
_RUNNER: FabricatedRunner | None = None


def get_runner() -> FabricatedRunner:
    global _RUNNER
    with _LOCK:
        if _RUNNER is None:
            # Scrub any legacy disk archive before exposing history. Neither
            # migration nor worker construction replays network requests.
            store = fh.FabricatedStateStore()
            try:
                store.sanitize_existing()
            except (OSError, ValueError):
                # A permissions/corruption problem must not expose raw file
                # content through the IPC error path or crash normal startup.
                pass
            _RUNNER = FabricatedRunner(state_store=store)
        return _RUNNER


def _session_open_id() -> str:
    config = ucampus_credentials.load()
    if config is None:
        raise UCampusProgressError("UCAMPUS_SESSION_MISSING")
    if config.variant != "ai":
        raise UCampusProgressError("UCAMPUS_AI_ONLY")
    return _jwt_open_id(config)


def dispatch(operation: str, request: dict[str, Any]) -> dict[str, Any] | None:
    if operation not in _OPERATIONS:
        return None
    if operation == "ucampus.fabricated.capabilities":
        try:
            import websocket
            socket_available = callable(getattr(websocket, "create_connection", None))
        except ImportError:
            socket_available = False
        configured = ucampus_credentials.status().get("configured") is True
        return {
            "ok": True, "local_generation": True,
            "socket_transport_available": socket_available,
            "session_configured": configured,
            "activity_heartbeat": "legacy_socketio_v3_start",
            "completion_packet": "newExploration/submit submitType=2",
            "server_readback": "course_progress pass/pass2/perm",
            "official_player_required": False,
            "message": "本地虚构心跳已就绪：中间包走 Socket.IO，末包按上游 submitType=2 申报完成",
        }
    if operation == "ucampus.fabricated.stop" and request.get("graceful") is True:
        get_runner().shutdown()
        return {"ok": True, "stopped": True}
    course_id = request.get("course_id")
    if not isinstance(course_id, str) or not fh._ID_RE.fullmatch(course_id):
        return {"ok": False, "error": "UCAMPUS_COURSE_REQUIRED"}
    if operation == "ucampus.fabricated.history":
        try:
            return {"ok": True,
                    "records": fh.FabricatedStateStore().list_recent(course_id),
                    "resume_available": False}
        except (ValueError, OSError):
            return {"ok": False, "error": "UCAMPUS_HISTORY_UNAVAILABLE"}
    runner = get_runner()
    if operation == "ucampus.fabricated.status":
        return {"ok": True, **runner.status(course_id)}
    if operation == "ucampus.fabricated.start":
        unit_id = request.get("unit_id")
        pulses = request.get("pulses", 5)
        speed = request.get("speed", 1.0)
        duration = request.get("duration_seconds", fh.DEFAULT_DURATION_SECONDS)
        instant = request.get("instant_complete", False)
        interval = request.get("heartbeat_interval", fh.DEFAULT_HEARTBEAT_INTERVAL)
        if (not isinstance(unit_id, str) or not fh._ID_RE.fullmatch(unit_id)
                or type(pulses) is not int or not 1 <= pulses <= fh.MAX_PULSES
                or not isinstance(speed, (int, float)) or isinstance(speed, bool)
                or not 0.25 <= float(speed) <= 16.0
                or not isinstance(duration, (int, float)) or isinstance(duration, bool)
                or not fh.MIN_DURATION_SECONDS <= float(duration) <= fh.MAX_DURATION_SECONDS
                or not isinstance(instant, bool)
                or not isinstance(interval, (int, float)) or isinstance(interval, bool)
                or not 0.01 <= float(interval) <= 3600):
            return {"ok": False, "error": "UCAMPUS_INVALID_FABRICATED_PARAMETER"}
        try:
            open_id = _session_open_id()
            reader = UCampusProgressReader()
            rows = reader.list_tasks(course_id, unit_id)
            targets = [
                fh.FabricatedTarget.from_progress_row(
                    course_id, unit_id, row, open_id=open_id,
                    duration_seconds=float(duration))
                for row in rows
                if str(row.get("type") or "").lower() in ("video", "audio")
                and row.get("completed") is not True
            ]
            if not targets:
                return {"ok": False, "error": "UCAMPUS_NO_MEDIA_TASKS"}
            transport_factory = lambda: FabricatedTransport(reader=reader)
            return {"ok": True, **runner.start(
                course_id, unit_id, targets, pulses=pulses, speed=float(speed),
                instant_complete=instant, heartbeat_interval=float(interval),
                transport_factory=transport_factory)}
        except UCampusProgressError as exc:
            return {"ok": False, "error": str(exc)}
        except (ValueError, FabricatedRunError) as exc:
            return {"ok": False, "error": str(exc)}
        except Exception:
            return {"ok": False, "error": "UCAMPUS_RUNTIME_UNAVAILABLE"}
    run_id = request.get("run_id")
    if (not isinstance(run_id, str) or len(run_id) != 32
            or not all(char in "0123456789abcdef" for char in run_id)
            or runner.status(course_id).get("run_id") != run_id):
        return {"ok": False, "error": "UCAMPUS_RUN_ID_MISMATCH"}
    try:
        result = runner.control(operation.rsplit(".", 1)[-1], run_id)
        if result.get("course_id") != course_id:
            return {"ok": False, "error": "UCAMPUS_RUN_ID_MISMATCH"}
        return {"ok": True, **result}
    except (ValueError, FabricatedRunError) as exc:
        return {"ok": False, "error": str(exc)}


def reset_runner() -> None:
    global _RUNNER
    with _LOCK:
        runner, _RUNNER = _RUNNER, None
    if runner is not None:
        runner.shutdown()


def shutdown() -> None:
    with _LOCK:
        runner = _RUNNER
    if runner is not None:
        runner.shutdown()


atexit.register(shutdown)
