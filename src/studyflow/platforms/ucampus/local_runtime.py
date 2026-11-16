"""Local observed-media heartbeat scheduler for U校园5.0.

The scheduler reuses StudyFlow's per-chapter task control semantics, not
Chaoxing's wire packet format. A real player observation source and audited
transport must be supplied to start; elapsed wall-clock time is never treated
as watched content or as platform-confirmed completion.
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
class MediaPosition:
    position_seconds: float
    playing: bool
    ended: bool = False

    def __post_init__(self) -> None:
        if (not isinstance(self.position_seconds, (int, float))
                or not math.isfinite(self.position_seconds)
                or not 0 <= self.position_seconds <= 3600000
                or type(self.playing) is not bool or type(self.ended) is not bool):
            raise ValueError("UCAMPUS_INVALID_OBSERVATION")


@dataclass(frozen=True)
class LocalPulse:
    run_id: str
    course_id: str
    chapter_id: str
    resource_id: str
    sequence: int
    observed_seconds: float


class MediaObserver(Protocol):
    def observe(self, task: MediaTask) -> MediaPosition | None: ...


class PulseTransport(Protocol):
    def send(self, pulse: LocalPulse) -> bool:
        """Whether the transport received the local pulse, not grade completion."""
        ...


class UCampusLocalRunner:
    def __init__(self, *, interval: float = 0.5):
        if not isinstance(interval, (float, int)) or not math.isfinite(interval) or not 0.01 <= interval <= 60:
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

    def start(self, course_id: str, tasks: list[MediaTask], *,
              observer: MediaObserver | None,
              transport: PulseTransport | None, concurrency: int = 2) -> dict:
        # This guards against running with fabricated timestamps or guessed
        # U校园 endpoints. Neither dependency is registered by default.
        if observer is None or transport is None:
            raise RuntimeError("UCAMPUS_HEARTBEAT_PROTOCOL_UNVERIFIED")
        if (not isinstance(course_id, str) or not 1 <= len(course_id) <= 128
                or type(concurrency) is not int or not 1 <= concurrency <= 4
                or not isinstance(tasks, list) or not tasks or len(tasks) > 200):
            raise ValueError("UCAMPUS_INVALID_PARAMETER")
        unique: set[str] = set()
        for task in tasks:
            if (not isinstance(task, MediaTask) or task.course_id != course_id
                    or task.resource_id in unique):
                raise ValueError("UCAMPUS_INVALID_MEDIA_TASK")
            unique.add(task.resource_id)
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise RuntimeError("UCAMPUS_TASK_ALREADY_RUNNING")
            self._run_id = uuid.uuid4().hex
            self._course_id = course_id
            self._phase = "running"
            self._paused = False
            self._tasks = {task.resource_id: {
                "resource_id": task.resource_id, "chapter_id": task.chapter_id,
                "title": task.title, "state": "queued", "observed_seconds": None,
                "attempted": 0, "accepted": 0, "server_completed": None,
            } for task in tasks}
            self._stop.clear()
            self._wake.clear()
            self._thread = threading.Thread(
                target=self._run, args=(list(tasks), observer, transport, concurrency),
                daemon=True, name="ucampus-local-runner")
            self._thread.start()
            return self.status(course_id)

    def _wait(self):
        self._wake.wait(self._interval)
        self._wake.clear()

    def _run(self, tasks: list[MediaTask], observer: MediaObserver,
             transport: PulseTransport, concurrency: int):
        chapters: dict[str, list[MediaTask]] = {}
        for task in tasks:
            chapters.setdefault(task.chapter_id, []).append(task)
        failed = False
        try:
            with ThreadPoolExecutor(max_workers=min(concurrency, len(chapters))) as pool:
                futures = [pool.submit(self._chapter, group, observer, transport)
                           for group in chapters.values()]
                for future in futures:
                    future.result()
            with self._lock:
                failed = any(task["state"] == "failed" for task in self._tasks.values())
        except Exception:
            failed = True
        finally:
            with self._lock:
                self._phase = "failed" if failed else "stopped" if self._stop.is_set() else "ended_locally"

    def _chapter(self, group: list[MediaTask], observer: MediaObserver, transport: PulseTransport):
        for task in group:
            with self._lock:
                if self._stop.is_set():
                    return
                self._tasks[task.resource_id]["state"] = "running"
            last_position = -1.0
            sequence = 0
            while not self._stop.is_set():
                with self._lock:
                    paused = self._paused
                if paused:
                    self._wait()
                    continue
                try:
                    observation = observer.observe(task)
                except Exception:
                    with self._lock:
                        self._tasks[task.resource_id]["state"] = "failed"
                    return
                if observation is not None and not isinstance(observation, MediaPosition):
                    with self._lock:
                        self._tasks[task.resource_id]["state"] = "failed"
                    return
                if observation is not None and observation.playing and observation.position_seconds > last_position:
                    sequence += 1
                    pulse = LocalPulse(
                        self._run_id, task.course_id, task.chapter_id, task.resource_id,
                        sequence, observation.position_seconds)
                    try:
                        accepted = transport.send(pulse) is True
                    except Exception:
                        with self._lock:
                            self._tasks[task.resource_id]["state"] = "failed"
                        return
                    with self._lock:
                        row = self._tasks[task.resource_id]
                        row["observed_seconds"] = observation.position_seconds
                        row["attempted"] += 1
                        row["accepted"] += int(accepted)
                    last_position = observation.position_seconds
                if observation is not None and observation.ended:
                    with self._lock:
                        self._tasks[task.resource_id]["state"] = "ended_locally"
                    break
                self._wait()
            if self._stop.is_set():
                with self._lock:
                    self._tasks[task.resource_id]["state"] = "stopped"
                return

    def _check_run(self, run_id: str):
        if not isinstance(run_id, str) or not run_id or run_id != self._run_id:
            raise ValueError("UCAMPUS_RUN_ID_MISMATCH")
        if self._thread is None or not self._thread.is_alive():
            raise RuntimeError("UCAMPUS_TASK_NOT_RUNNING")

    def control(self, action: str, run_id: str) -> dict:
        with self._lock:
            self._check_run(run_id)
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
            selected = course_id == self._course_id
            active = bool(selected and self._thread is not None and self._thread.is_alive())
            return {
                "run_id": self._run_id if selected else "",
                "course_id": course_id,
                "phase": self._phase if selected else "idle",
                "active": active,
                "paused": active and self._paused,
                "tasks": [dict(item) for item in self._tasks.values()] if selected else [],
                "sent": sum(t["attempted"] for t in self._tasks.values()) if selected else 0,
                "transport_accepted": sum(t["accepted"] for t in self._tasks.values()) if selected else 0,
                # No observed position or accepted pulse implies server completion.
                "server_confirmed": None,
            }
