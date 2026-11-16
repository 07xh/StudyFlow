"""Local scheduler for fabricated U校园 media heartbeats.

Runs without the official player: for every resource it invents a linear
0 -> duration playback timeline, emits one activity heartbeat per invented
position at a local (speed-scaled) interval, then sends the upstream-verified
mark-seen packet as the final heartbeat. Server completion is only reported
when ``code=0`` AND a read-only progress readback confirms the pass flag.
"""
from __future__ import annotations

import math
import threading
import time
import uuid
from typing import Any, Callable

from . import fabricated_heartbeat as fh
from .fabricated_transport import FabricatedTransport


class FabricatedRunError(RuntimeError):
    """Public error codes only."""


class FabricatedRunner:
    def __init__(self, *, interval: float = fh.DEFAULT_HEARTBEAT_INTERVAL,
                 transport_factory: Callable[[], FabricatedTransport] | None = None,
                 state_store: fh.FabricatedStateStore | None = None,
                 clock: Callable[[], float] = time.monotonic):
        if (not isinstance(interval, (int, float)) or not math.isfinite(interval)
                or not 0.01 <= interval <= 3600):
            raise ValueError("UCAMPUS_INVALID_FABRICATED_PARAMETER")
        self._interval = float(interval)
        self._transport_factory = transport_factory or FabricatedTransport
        self._store = state_store
        self._clock = clock
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._run_id = ""
        self._course_id = ""
        self._unit_id = ""
        self._phase = "idle"
        self._paused = False
        self._tasks: dict[str, dict[str, Any]] = {}
        self._transport: FabricatedTransport | None = None
        self._started_at = 0.0
        self._last_error = ""

    def start(self, course_id: str, unit_id: str,
              targets: list[fh.FabricatedTarget], *, pulses: int = 5,
              speed: float = 1.0, instant_complete: bool = False,
              heartbeat_interval: float | None = None,
              transport_factory: Callable[[], FabricatedTransport] | None = None) -> dict:
        if (not isinstance(course_id, str) or not fh._ID_RE.fullmatch(course_id)
                or not isinstance(unit_id, str) or not fh._ID_RE.fullmatch(unit_id)
                or type(pulses) is not int or not 1 <= pulses <= fh.MAX_PULSES
                or not isinstance(targets, list) or not 1 <= len(targets) <= 200):
            raise ValueError("UCAMPUS_INVALID_FABRICATED_PARAMETER")
        interval = self._interval if heartbeat_interval is None else heartbeat_interval
        if (not isinstance(interval, (int, float)) or isinstance(interval, bool)
                or not math.isfinite(interval) or not 0.01 <= interval <= 3600):
            raise ValueError("UCAMPUS_INVALID_FABRICATED_PARAMETER")
        seen: set[str] = set()
        for target in targets:
            target.validate()
            if (target.course_id != course_id or target.unit_id != unit_id
                    or target.resource_id in seen):
                raise ValueError("UCAMPUS_INVALID_FABRICATED_TARGET")
            seen.add(target.resource_id)
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise FabricatedRunError("UCAMPUS_TASK_ALREADY_RUNNING")
            self._run_id = uuid.uuid4().hex
            self._course_id, self._unit_id = course_id, unit_id
            self._phase = "running"
            self._paused = False
            self._last_error = ""
            self._started_at = self._clock()
            self._tasks = {target.resource_id: {
                "resource_id": target.resource_id, "title": target.title,
                "dtype": target.dtype,
                "duration_seconds": round(target.duration_seconds, 3),
                "state": "queued", "generated": 0, "sent": 0,
                "accepted": 0, "confirmed": 0,
                "position_seconds": 0.0, "server_completed": None,
                "last_error": "",
            } for target in targets}
            self._stop.clear()
            self._wake.clear()
            self._transport = (transport_factory or self._transport_factory)()
            self._thread = threading.Thread(
                target=self._run,
                args=(list(targets), 1 if instant_complete else pulses,
                      speed, float(interval)),
                name="ucampus-fabricated-heartbeat", daemon=True)
            self._thread.start()
            return self.status(course_id)

    def _wait(self, seconds: float) -> None:
        self._wake.wait(seconds)
        self._wake.clear()

    def _run(self, targets: list[fh.FabricatedTarget], pulses: int,
             speed: float, interval: float) -> None:
        transport = self._transport
        failed = False
        try:
            if transport is not None:
                try:
                    transport.open()
                except Exception:
                    with self._lock:
                        self._last_error = "UCAMPUS_SESSION_MISSING"
            for target in targets:
                if self._stop.is_set():
                    break
                timeline = fh.FabricatedTimeline(target, pulses, speed=speed)
                with self._lock:
                    self._tasks[target.resource_id]["state"] = "running"
                for sequence in range(1, pulses + 1):
                    if self._stop.is_set():
                        break
                    if not self._resume_gate():
                        break
                    with self._lock:
                        pulse = timeline.make_pulse(sequence, self._run_id)
                        row = self._tasks[target.resource_id]
                        row["generated"] += 1
                        row["position_seconds"] = pulse.position_seconds
                    receipt = transport.send_result(pulse, target) if transport else None
                    with self._lock:
                        row = self._tasks[target.resource_id]
                        if receipt is None:
                            row["state"] = "failed"
                            row["last_error"] = "UCAMPUS_SENDER_UNAVAILABLE"
                            failed = True
                            break
                        if receipt.state == fh.FabricatedSendState.SENT.value or receipt.completion:
                            row["sent"] += 1
                        row["accepted"] += int(receipt.accepted)
                        row["confirmed"] += int(receipt.server_confirmed is True)
                        row["server_completed"] = receipt.server_confirmed
                        row["last_error"] = "" if receipt.accepted or not receipt.completion else receipt.state
                        if receipt.completion:
                            row["state"] = ("confirmed" if receipt.server_confirmed is True
                                            else "reported" if receipt.accepted else "rejected")
                            if row["state"] == "rejected":
                                failed = True
                                break
                    if sequence < pulses:
                        self._wait(timeline.wall_interval(interval))
                with self._lock:
                    row = self._tasks[target.resource_id]
                    if row["state"] == "running":
                        row["state"] = "stopped" if self._stop.is_set() else "reported"
            self._persist()
        except Exception as exc:
            failed = True
            with self._lock:
                self._last_error = f"UCAMPUS_RUN_FAILED:{type(exc).__name__}:{exc}"[:200]
        finally:
            if transport is not None:
                transport.close()
            with self._lock:
                self._phase = ("failed" if failed else
                               "stopped" if self._stop.is_set() else
                               "finished_locally")

    def _resume_gate(self) -> bool:
        while not self._stop.is_set():
            with self._lock:
                if not self._paused:
                    return True
            self._wait(0.2)
        return False

    def _persist(self) -> None:
        if self._store is None:
            return
        with self._lock:
            record = {"course_id": self._course_id, "unit_id": self._unit_id,
                      "phase": self._phase, "tasks": dict(self._tasks)}
        self._store.save(self._run_id, record)

    def control(self, action: str, run_id: str) -> dict:
        with self._lock:
            if not run_id or run_id != self._run_id:
                raise ValueError("UCAMPUS_RUN_ID_MISMATCH")
            if self._thread is None or not self._thread.is_alive():
                raise FabricatedRunError("UCAMPUS_TASK_NOT_RUNNING")
            if action == "pause":
                self._paused = True
                self._phase = "paused"
            elif action == "resume":
                self._paused = False
                self._phase = "running"
                self._wake.set()
            elif action == "stop":
                self._paused = False
                self._phase = "stopping"
                self._stop.set()
                self._wake.set()
            else:
                raise ValueError("UCAMPUS_INVALID_ACTION")
            return self.status(self._course_id)

    def wait(self, timeout: float = 0) -> bool:
        """Join a finished run without changing its terminal phase."""
        thread = self._thread
        if thread is None:
            return False
        thread.join(timeout=timeout if timeout > 0 else None)
        return not thread.is_alive()

    def shutdown(self) -> None:
        thread = self._thread
        if thread is not None and thread.is_alive():
            self._stop.set()
            self._wake.set()
            thread.join(timeout=8)
        self._persist()

    def status(self, course_id: str) -> dict:
        with self._lock:
            own = course_id == self._course_id
            rows = [dict(row) for row in self._tasks.values()] if own else []
            active = bool(own and self._thread is not None and self._thread.is_alive())
            return {
                "run_id": self._run_id if own else "",
                "course_id": course_id,
                "unit_id": self._unit_id if own else "",
                "phase": self._phase if own else "idle",
                "active": active,
                "paused": bool(active and self._paused),
                "tasks": rows,
                "generated": sum(row["generated"] for row in rows),
                "sent": sum(row["sent"] for row in rows),
                "transport_accepted": sum(row["accepted"] for row in rows),
                "server_confirmed": sum(row["confirmed"] for row in rows),
                "completed": sum(row["state"] == "confirmed" for row in rows),
                "reported": sum(row["state"] == "reported" for row in rows),
                "sender_connected": bool(own and self._transport is not None
                                         and self._transport.connected),
                "last_error": self._last_error if own else "",
            }
