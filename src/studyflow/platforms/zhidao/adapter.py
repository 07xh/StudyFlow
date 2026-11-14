"""Zhidao integration boundary; no session is fabricated."""
from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo


class ZhidaoAdapter:
    def connection_info(self) -> ConnectionInfo:
        return ConnectionInfo(Platform.ZHIDAO, False, "知到登录和课程读取尚未接入")

    def list_courses(self) -> list[Course]:
        raise RuntimeError("知到真实课程读取尚未接入")
