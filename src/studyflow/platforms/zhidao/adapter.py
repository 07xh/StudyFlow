"""Zhidao adapter preserving the original installed runtime."""
from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo
from .legacy_runtime import probe_login, read_courses


class ZhidaoAdapter:
    def connection_info(self) -> ConnectionInfo:
        connected = probe_login()
        return ConnectionInfo(
            Platform.ZHIDAO, connected,
            "服务端登录校验通过" if connected else "未安装原版运行时、未登录或网络不可用",
        )

    def list_courses(self) -> list[Course]:
        return read_courses()
