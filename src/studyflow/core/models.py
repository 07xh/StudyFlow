"""统一课程数据契约：仅承载真实平台读取的数据。"""
from dataclasses import dataclass
from enum import Enum


class Platform(str, Enum):
    ZHIDAO = "zhidao"
    YUKETANG = "yuketang"


@dataclass(frozen=True)
class Course:
    platform: Platform
    course_id: str
    title: str
    progress_percent: float | None = None
    course_type: str | None = None
    stale: bool = False
    progress_evidence: str | None = None
    verified_at: str | None = None

    def __post_init__(self) -> None:
        if not self.course_id or not self.title:
            raise ValueError("course_id and title are required")
        if self.course_type not in (None, "ai", "shared"):
            raise ValueError("unsupported course_type")
        if not isinstance(self.stale, bool):
            raise ValueError("stale must be bool")
        if self.progress_evidence not in (None, "server_verified"):
            raise ValueError("unsupported progress evidence")
        if self.progress_evidence == "server_verified" and not self.verified_at:
            raise ValueError("verified progress requires a timestamp")
        if self.verified_at is not None and not isinstance(self.verified_at, str):
            raise ValueError("verified_at must be a string")
        if self.progress_percent is not None and not 0 <= self.progress_percent <= 100:
            raise ValueError("progress_percent must be in [0, 100]")
