"""Optional task-runner contract for the unified StudyFlow application.

This platform ships metadata and settings. A user-owned runtime may implement
this protocol without patching the React shell, original players or credentials.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

TaskPhase = Literal["queued", "running", "paused", "completed", "failed", "stopped"]
RunPhase = Literal["idle", "preparing", "running", "paused", "completed", "partial", "failed", "stopped"]


@dataclass(frozen=True)
class TaskProgress:
    """UI-safe task observation; not evidence of course completion."""
    task_id: str
    chapter_id: str
    title: str
    task_type: str
    phase: TaskPhase
    message: str = ""


@dataclass(frozen=True)
class RunSnapshot:
    """Opaque run identity and task states for the shared tasks center."""
    run_id: str
    course_key: str
    phase: RunPhase
    tasks: tuple[TaskProgress, ...] = ()
    error_code: str | None = None


class XuexitongTaskRunner(Protocol):
    """An optional runner implemented inside the packaged Python sidecar."""
    def start(self, course_key: str) -> RunSnapshot: ...
    def status(self) -> RunSnapshot: ...
    def pause(self, expected_run_id: str) -> RunSnapshot: ...
    def resume(self, expected_run_id: str) -> RunSnapshot: ...
    def stop(self, expected_run_id: str) -> RunSnapshot: ...
