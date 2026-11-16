"""Locally generated U校园 heartbeat scheduler, independent of official players.

Local ticks are never represented as viewed seconds or server-completed lessons.
No U校园 request is sent until a separately audited transport is installed.
"""
from __future__ import annotations

import math
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class MediaTask:
    course_id: str
    chapter_id: str
    resource_id: str
    title: str

    def __post_init__(self) -> None:
        for value in (self.course_id, self.chapter_id, self.resource_id, self.title):
            if not isinstance(value, str) or not 1 <= len(value) <= 128:
                raise ValueError("UCAMPUS_INVALID_MEDIA_TASK")


@dataclass(frozen=True)
class LocalPulse:
    run_id: str
    course_id: str
    chapter_id: str
    resource_id: str
    sequence: int
    local_elapsed_seconds: float


class PulseTransport(Protocol):
    """Explicit platform-specific transport, not the official media player."""

    def send(self, pulse: LocalPulse) -> bool:
        """True means transport accepted, never means course completed."""
        ...


class UCampusLocalRunner:
    """Concurrent chapter queues; resources within a chapter run in order."""

    def __init__(self, *, interval: float = 2.0):
        if (not isinstance(interval, (int, float)) or not math.isfinite(interval)
                or not 0.01 <= interval <= 60):
            raise ValueError("UCAMPUS_INVALID_INTERVAL")
        self._interval = float(interval)
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._run_id = ""
        self._course_id = ""
        self._phase = "idle"
        self._paused = False
        self._tasks: dict[str, dict] = {}
        self._started_at = 0.0

    def start(self, course_id: str, tasks: list[MediaTask], *,
              transport: PulseTransport | None = None,
              concurrency: int = 2, pulses_per_resource: int = 5) -> dict:
        if (not isinstance(course_id, str) or not 1 <= len(course_id) <= 128
                or type(concurrency) is not int or not 1 <= concurrency <= 4
                or type(pulses_per_resource) is not int or not 1 <= pulses_per_resource <= 100
                or not isinstance(tasks, list) or not 1 <= len(tasks) <= 200):
            raise ValueError("UCAMPUS_INVALID_PARAMETER")
        ids: set[str] = set()
        for task in tasks:
            if (not isinstance(task, MediaTask) or task.course_id != course_id
                    or task.resource_id in ids):
                raise ValueError("UCAMPUS_INVALID_MEDIA_TASK")
            ids.add(task.resource_id)
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise RuntimeError("UCAMPUS_TASK_ALREADY_RUNNING")
            self._run_id = uuid.uuid4().hex
            self._course_id = course_id
            self._phase = "running"
            self._paused = False
            self._started_at = time.monotonic()
            self._tasks = {task.resource_id: {
                "resource_id": task.resource_id, "chapter_id": task.chapter_id,
                "title": task.title, "state": "queued", "generated": 0,
                "attempted": 0, "accepted": 0,
                "local_elapsed_seconds": 0.0, "server_completed": None
            } for task in tasks}
            self._stop.clear()
            self._wake.clear()
            self._thread = threading.Thread(
                target=self._run,
                args=(list(tasks), transport, concurrency, pulses_per_resource),
                name="ucampus-local-heartbeat", daemon=True)
            self._thread.start()
            return self.status(course_id)

    def _wait(self):
        self._wake.wait(self._interval)
        self._wake.clear()

    def _run(self, tasks: list[MediaTask], transport: PulseTransport | None,
             concurrency: int, pulses_per_resource: int):
        chapters: dict[str, list[MediaTask]] = {}
        for task in tasks:
            chapters.setdefault(task.chapter_id, []).append(task)
        failed = False
        try:
            with ThreadPoolExecutor(max_workers=min(concurrency, len(chapters))) as pool:
                futures = [pool.submit(self._chapter, group, transport, pulses_per_resource)
                           for group in chapters.values()]
                for future in futures:
                    future.result()
            with self._lock:
                failed = any(row["state"] == "failed" for row in self._tasks.values())
        except Exception:
            failed = True
        finally:
            with self._lock:
                self._phase = "failed" if failed else "stopped" if self._stop.is_set() else "finished_locally"

    def _chapter(self, tasks: list[MediaTask], transport: PulseTransport | None,
                 pulses_per_resource: int):
        for task in tasks:
            with self._lock:
                if self._stop.is_set():
                    return
                self._tasks[task.resource_id]["state"] = "running"
            active_seconds = 0.0
            last_tick = time.monotonic()
            for sequence in range(1, pulses_per_resource + 1):
                while not self._stop.is_set():
                    with self._lock:
                        paused = self._paused
                    if paused:
                        self._wait()
                        last_tick = time.monotonic()
                        continue
                    self._wait()
                    with self._lock:
                        if self._stop.is_set() or self._paused:
                            continue
                        now = time.monotonic()
                        active_seconds += max(0.0, now - last_tick)
                        last_tick = now
                        # This is the local scheduler clock, NOT playback position.
                        pulse = LocalPulse(
                            self._run_id, task.course_id, task.chapter_id,
                            task.resource_id, sequence, round(active_seconds, 3))
                        row = self._tasks[task.resource_id]
                        row["local_elapsed_seconds"] = pulse.local_elapsed_seconds
                        row["generated"] += 1
                        # Bookkeeping is protected, but never hold the global
                        # scheduler lock across potentially blocking I/O.
                        if transport is not None:
                            row["attempted"] += 1
                    if transport is not None:
                        try:
                            accepted = transport.send(pulse) is True
                        except Exception:
                            with self._lock:
                                self._tasks[task.resource_id]["state"] = "failed"
                            return
                        with self._lock:
                            self._tasks[task.resource_id]["accepted"] += int(accepted)
                    break
                if self._stop.is_set():
                    break
            with self._lock:
                self._tasks[task.resource_id]["state"] = (
                    "stopped" if self._stop.is_set() else "finished_locally")

    def control(self, action: str, run_id: str) -> dict:
        with self._lock:
            if not run_id or run_id != self._run_id:
                raise ValueError("UCAMPUS_RUN_ID_MISMATCH")
            if self._thread is None or not self._thread.is_alive():
                raise RuntimeError("UCAMPUS_TASK_NOT_RUNNING")
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

    def shutdown(self):
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=8)

    def status(self, course_id: str) -> dict:
        with self._lock:
            own = course_id == self._course_id
            rows = [dict(row) for row in self._tasks.values()] if own else []
            active = bool(own and self._thread is not None and self._thread.is_alive())
            return {
                "run_id": self._run_id if own else "",
                "course_id": course_id,
                "phase": self._phase if own else "idle",
                "active": active,
                "paused": bool(active and self._paused),
                "tasks": rows,
                "generated": sum(row["generated"] for row in rows),
                "sent": sum(row["attempted"] for row in rows),
                "transport_accepted": sum(row["accepted"] for row in rows),
                "server_confirmed": None,
                "sender_connected": False,
            }
