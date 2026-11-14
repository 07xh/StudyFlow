"""Explicit contract for independent read-only platform integrations."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .models import Course, Platform


@dataclass(frozen=True)
class ConnectionInfo:
    platform: Platform
    connected: bool
    message: str


class LearningPlatform(Protocol):
    def connection_info(self) -> ConnectionInfo: ...
    def list_courses(self) -> list[Course]: ...
