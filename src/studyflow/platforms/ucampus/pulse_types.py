"""Data-only contract for isolated U校园 transport research.

No task scheduling or network sender is registered here.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class LocalPulse:
    run_id: str
    course_id: str
    chapter_id: str
    resource_id: str
    sequence: int
    local_elapsed_seconds: float
