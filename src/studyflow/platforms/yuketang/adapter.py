"""Rain Classroom integration boundary.

The upstream main.py is intentionally not imported: it mutates process-wide
stdout/stderr and opens log files on import. No fake courses are provided.
"""
from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo


class YuketangAdapter:
    def connection_info(self) -> ConnectionInfo:
        return ConnectionInfo(Platform.YUKETANG, False, "雨课堂运行时尚未完成隔离与连接")

    def list_courses(self) -> list[Course]:
        raise RuntimeError("雨课堂真实课程读取尚未接入")
