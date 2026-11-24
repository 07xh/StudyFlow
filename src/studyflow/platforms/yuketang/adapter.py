"""Live Rain Classroom read-only adapter using existing authenticated sessions."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo
from .credentials import YuketangConfig, load, SessionStorageError
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
        try:
            config = load()
        except SessionStorageError:
            return ConnectionInfo(Platform.YUKETANG, False, "本机登录凭据存储异常，请检查用户权限")
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

    def list_videos(self, course_id: str | None = None) -> list[dict[str, str]]:
        config = load()
        if config is None:
            raise RuntimeError("Rain Classroom session is missing")
        # The selected course must match the currently authenticated classroom.
        # A stale UI selection must never receive another classroom's chapters.
        if course_id is not None and course_id != config.classroom_id:
            raise LookupError("Selected course is not the configured classroom")
        return make_reader(config).video_metadata(config.classroom_id, sign=config.sign,
                                                  uv_id=config.university_id)


    def course_progress(self, course_id: str, *, offset: int = 0, limit: int = 8) -> dict:
        """Bounded, strictly read-only server verification for the selected classroom.

        An unknown video stays unverified: errors must not be converted to zero
        or a completed local playback estimate. Workers use independent
        requests.Session instances (not a shared mutable Session).
        """
        config = load()
        if config is None:
            raise RuntimeError("Rain Classroom session is missing")
        if course_id != config.classroom_id:
            raise LookupError("Selected course is not the configured classroom")
        if (type(offset) is not int or not 0 <= offset <= 5000
                or type(limit) is not int or not 1 <= limit <= 12):
            raise ValueError("Invalid page bounds")

        videos = make_reader(config).video_metadata(
            config.classroom_id, sign=config.sign, uv_id=config.university_id
        )
        total = len(videos)
        page = videos[offset:offset + limit]

        def verify(row: dict) -> dict:
            result = {"id": row["id"], "name": row["name"],
                      "chapter": row["chapter"], "progress_percent": None,
                      "server_completed": None, "last_point_seconds": None,
                      "duration_seconds": None, "verified_at": None}
            try:
                progress = make_reader(config).read_video_progress(config.classroom_id, row["id"])
                percent = progress["progress_percent"]
                if type(percent) not in (int, float) or not 0 <= percent <= 100:
                    return result
                result.update(progress_percent=percent, server_completed=progress["server_completed"],
                              last_point_seconds=progress["last_point_seconds"],
                              duration_seconds=progress["duration_seconds"],
                              verified_at=datetime.now(timezone.utc).isoformat())
            except Exception:
                # Do not leak credentials, server JSON, URLs or private account
                # information to UI/error logs on a failed video verification.
                pass
            return result

        with ThreadPoolExecutor(max_workers=3) as executor:
            items = list(executor.map(verify, page))
        next_offset = offset + len(page)
        return {"course_id": course_id, "offset": offset, "total": total,
                "next_offset": next_offset if next_offset < total else None,
                "items": items}
