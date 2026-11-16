"""Conservative U校园AI 5.0 course reader; no inferred progress or write actions.

The AI homepage and bookshelf response shapes are adapted from the GPL-3.0
Zzj-klwgxdz/UnipusAI source (src/api/course.rs, GitHub, checked 2026-11-16).
This module is part of GPL-3.0 StudyFlow. Original attribution is preserved.

The upstream endpoint and parser are unverified against this user's account.
We accept only recognizable structures and never present guessed data.
"""
from __future__ import annotations

from typing import Any
import requests

from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo
from . import credentials

AI_BOOKSHELF_URL = "https://uai.unipus.cn/api/cmgt/course/my/bookshelf"


class UCampusCatalogError(RuntimeError):
    pass


def _text(row: dict, keys: tuple[str, ...], limit: int) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:limit]
        if type(value) is int and value >= 0:
            return str(value)
    return ""


def _course(id_value: str, title: str) -> Course:
    return Course(platform=Platform.UCAMPUS, course_id=id_value, title=title)


def _dedupe(courses: list[Course]) -> list[Course]:
    unique: dict[str, Course] = {}
    for course in courses:
        unique.setdefault(course.course_id, course)
    return list(unique.values())


def _parse_ai_home(value: dict) -> list[Course]:
    rows = value.get("courseList")
    if not isinstance(rows, list) or len(rows) > 500:
        raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
    result = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        fallback = _text(row, ("name",), 200)
        resources = row.get("courseResourceList")
        if not isinstance(resources, list):
            continue
        for resource in resources[:500]:
            if not isinstance(resource, dict):
                continue
            course_id = _text(resource, ("instanceId",), 128)
            title = _text(resource, ("name",), 200) or fallback
            if course_id and title:
                result.append(_course(course_id, title))
    return _dedupe(result)


def _parse_ai_bookshelf(value: dict) -> list[Course]:
    groups = value.get("groups")
    if not isinstance(groups, dict):
        raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
    result: list[Course] = []
    # Archived/expired books should not masquerade as available courses.
    for category in ("CLASS_COURSE", "PERSONAL"):
        rows = groups.get(category, [])
        if not isinstance(rows, list) or len(rows) > 500:
            raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
        for row in rows:
            if not isinstance(row, dict):
                continue
            course_id = _text(row, ("instanceId",), 128)
            title = _text(row, ("name",), 200)
            if course_id and title:
                result.append(_course(course_id, title))
    return _dedupe(result)


def parse_catalog(payload: Any) -> list[Course]:
    """Recognize upstream U校园AI envelopes or explicit generic lists only."""
    if isinstance(payload, dict):
        if payload.get("success") is False or payload.get("code") in (401, 403, "401", "403"):
            raise UCampusCatalogError("UCAMPUS_SESSION_EXPIRED")
        if "value" in payload:
            if payload.get("code") != 1 and payload.get("success") is not True:
                raise UCampusCatalogError("UCAMPUS_CATALOG_UNAVAILABLE")
            value = payload.get("value")
            if not isinstance(value, dict):
                raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
            if "courseList" in value:
                return _parse_ai_home(value)
            if "groups" in value:
                return _parse_ai_bookshelf(value)
            raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
        if "code" in payload and payload.get("code") not in (0, 1):
            raise UCampusCatalogError("UCAMPUS_CATALOG_UNAVAILABLE")
    for _ in range(4):
        if isinstance(payload, list):
            break
        if not isinstance(payload, dict):
            raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
        payload = next((payload[key] for key in
                        ("courses", "courseList", "list", "rows", "items", "data", "result")
                        if isinstance(payload.get(key), (dict, list))), None)
    if not isinstance(payload, list) or len(payload) > 500:
        raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
    result = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        course_id = _text(row, ("courseId", "course_id", "courseID", "id"), 128)
        title = _text(row, ("courseName", "course_name", "name", "title"), 200)
        if course_id and title:
            result.append(_course(course_id, title))
    if payload and not result:
        raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
    return _dedupe(result)


class UCampusAdapter:
    def connection_info(self) -> ConnectionInfo:
        if credentials.load() is None:
            return ConnectionInfo(Platform.UCAMPUS, False, "尚未配置 U校园会话")
        try:
            courses = self.list_courses()
            if not courses:
                return ConnectionInfo(Platform.UCAMPUS, False,
                                      "课程接口返回空列表，账号与课程绑定状态尚不能确认")
            return ConnectionInfo(Platform.UCAMPUS, True, "U校园课程目录读取成功（学习与进度尚未验收）")
        except UCampusCatalogError as exc:
            messages = {
                "UCAMPUS_SESSION_EXPIRED": "U校园会话已失效，请重新登录",
                "UCAMPUS_CATALOG_FORMAT_UNVERIFIED": "U校园课程响应格式不匹配",
                "UCAMPUS_CATALOG_UNAVAILABLE": "U校园课程接口暂不可用",
            }
            return ConnectionInfo(Platform.UCAMPUS, False,
                                  messages.get(str(exc), "U校园课程状态未核验"))
        except Exception:
            return ConnectionInfo(Platform.UCAMPUS, False, "U校园课程状态暂不可核验")

    @staticmethod
    def _fetch(url: str, headers: dict[str, str]) -> list[Course]:
        try:
            response = requests.get(url, headers=headers, timeout=(5, 12), allow_redirects=False)
            if response.status_code in (401, 403):
                raise UCampusCatalogError("UCAMPUS_SESSION_EXPIRED")
            if response.status_code != 200 or response.is_redirect:
                raise UCampusCatalogError("UCAMPUS_CATALOG_UNAVAILABLE")
            if len(response.content) > 2_000_000:
                raise UCampusCatalogError("UCAMPUS_CATALOG_UNAVAILABLE")
            if "json" not in response.headers.get("content-type", "").lower():
                raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
            return parse_catalog(response.json())
        except (requests.RequestException, ValueError) as exc:
            raise UCampusCatalogError("UCAMPUS_CATALOG_UNAVAILABLE") from exc

    def list_courses(self) -> list[Course]:
        config = credentials.load()
        if config is None:
            raise UCampusCatalogError("UCAMPUS_SESSION_MISSING")
        headers = {
            "Accept": "application/json",
            "Cookie": config.cookie,
            "User-Agent": "StudyFlow UCampus read-only client",
        }
        if config.authorization:
            headers["Authorization"] = config.authorization
        courses = self._fetch(config.catalog_url, headers)
        # A second fixed, documented first-party GET is allowed only for the
        # upstream AI homepage route; never follow a server-provided URL.
        if (not courses and config.variant == "ai" and
                config.catalog_url == credentials.AI_HOME_COURSES_URL):
            courses = self._fetch(AI_BOOKSHELF_URL, headers)
        return courses
