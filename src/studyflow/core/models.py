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

    def __post_init__(self) -> None:
        if not self.course_id or not self.title:
            raise ValueError("course_id and title are required")
        if self.progress_percent is not None and not 0 <= self.progress_percent <= 100:
            raise ValueError("progress_percent must be in [0, 100]")
