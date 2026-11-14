"""Live Rain Classroom read-only adapter using existing authenticated sessions."""
from __future__ import annotations

from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo
from .credentials import YuketangConfig, load
from .readonly import YuketangReadOnly


def make_reader(config: YuketangConfig) -> YuketangReadOnly:
    return YuketangReadOnly(
        cookies={
            "sessionid": config.session_id, "csrftoken": config.csrf_token,
            "uv_id": config.university_id, "university_id": config.university_id,
            "classroom_id": config.classroom_id, "classroomId": config.classroom_id,
            "login_type": "WX", "xtbz": "ykt", "platform_id": "3", "platform_type": "1",
        },
        university_id=config.university_id, csrf_token=config.csrf_token,
    )


def _course_name(info: dict) -> str:
    if info.get("success") is not True:
        raise RuntimeError("Rain Classroom session validation failed")
    data = info.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("Rain Classroom classroom data invalid")
    candidates = [data]
    for key in ("course", "classroom", "course_info"):
        nested = data.get(key)
        if isinstance(nested, dict):
            candidates.append(nested)
    for row in candidates:
        for key in ("course_name", "courseName", "name", "classroom_name", "classroomName", "title"):
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    raise RuntimeError("Rain Classroom returned no identifiable course name")


class YuketangAdapter:
    def connection_info(self) -> ConnectionInfo:
        config = load()
        if config is None:
            return ConnectionInfo(Platform.YUKETANG, False, "未配置有效雨课堂登录会话")
        try:
            info = make_reader(config).classroom_info(config.classroom_id)
            _course_name(info)
            return ConnectionInfo(Platform.YUKETANG, True, "课堂接口验证通过")
        except Exception:
            return ConnectionInfo(Platform.YUKETANG, False, "会话失效、网络错误或课堂数据不完整")

    def list_courses(self) -> list[Course]:
        config = load()
        if config is None:
            raise RuntimeError("Rain Classroom session is missing")
        title = _course_name(make_reader(config).classroom_info(config.classroom_id))
        return [Course(platform=Platform.YUKETANG, course_id=config.classroom_id,
                       title=title, progress_percent=None)]

    def list_videos(self) -> list[dict[str, str]]:
        config = load()
        if config is None:
            raise RuntimeError("Rain Classroom session is missing")
        return make_reader(config).video_metadata(config.classroom_id, sign=config.sign,
                                                  uv_id=config.university_id)
