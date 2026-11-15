"""Real Xuexitong course, chapter and video task discovery.

The adapter returns no preview courses. Authentication stays in Windows
Credential Manager; video tokens are kept inside the packaged Python process.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo
from . import credentials

COURSES_URL = "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata"
CHAPTERS_URL = "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse"
CARDS_URL = "https://mooc1.chaoxing.com/mooc-ans/knowledge/cards"
STATUS_URL = "https://mooc1.chaoxing.com/ananas/status/"


@dataclass(frozen=True)
class VideoTask:
    course_key: str
    chapter_id: str
    chapter: str
    title: str
    clazz_id: str
    course_id: str
    cpi: str
    job_id: str
    object_id: str
    other_info: str
    duration: int
    initial_seconds: int
    dtoken: str
    rt: float
    face_enc: str = ""
    att_duration_enc: str = ""


def _session() -> requests.Session:
    cookies = credentials.load()
    if not cookies:
        raise RuntimeError("XUEXITONG_SESSION_MISSING")
    session = requests.Session()
    session.cookies.update(cookies)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/json,*/*",
        "Referer": "https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction",
    })
    return session


def _checked(response: requests.Response) -> str:
    if response.status_code != 200 or response.is_redirect:
        raise RuntimeError("XUEXITONG_RESPONSE_UNAVAILABLE")
    body = response.text
    # An HTML login page must never be mistaken for an authenticated empty course list.
    if "passport2.chaoxing.com" in body or "login.chaoxing.com" in body:
        raise RuntimeError("XUEXITONG_SESSION_EXPIRED")
    return body


def _course_ids(course_key: str) -> tuple[str, str, str]:
    if not isinstance(course_key, str) or not re.fullmatch(r"[0-9]{1,24}:[0-9]{1,24}:[0-9]{1,24}", course_key):
        raise ValueError("INVALID_XUEXITONG_COURSE")
    return tuple(course_key.split(":"))


def _embedded_marg(text: str) -> dict[str, Any] | None:
    """Decode a JSON object assigned to mArg without truncating nested braces.

    The source page can contain quoted closing braces and escaped quotes.
    A shallow regular expression would silently discard those task cards.
    """
    match = re.search(r"\bmArg\s*=\s*\{", text)
    if not match:
        return None
    start = match.end() - 1
    depth = 0
    quote_char = ""
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if quote_char:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                quote_char = ""
            continue
        if char == '"':
            quote_char = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    result = json.loads(text[start:index + 1])
                except (ValueError, TypeError):
                    return None
                return result if isinstance(result, dict) else None
    return None


class XuexitongAdapter:
    def connection_info(self) -> ConnectionInfo:
        if credentials.load() is None:
            return ConnectionInfo(Platform.XUEXITONG, False, "未导入学习通登录会话")
        try:
            self._course_html()
            return ConnectionInfo(Platform.XUEXITONG, True, "学习通课程接口已响应")
        except Exception:
            return ConnectionInfo(Platform.XUEXITONG, False, "会话失效或课程接口不可用")

    def _course_html(self) -> str:
        with _session() as session:
            response = session.post(COURSES_URL, data={
                "courseType": 1, "courseFolderId": 0, "query": "", "superstarClass": 0,
            }, timeout=(5, 12), allow_redirects=False)
            return _checked(response)

    @staticmethod
    def _parse_courses(html: str, seen: set[str]) -> list[Course]:
        """Parse only server-returned courses; deduplicate across folders."""
        soup = BeautifulSoup(html, "html.parser")
        courses: list[Course] = []
        for item in soup.select("div.course"):
            if item.select_one("a.not-open-tip,div.not-open-tip"):
                continue
            course_id = item.select_one("input.courseId")
            clazz_id = item.select_one("input.clazzId")
            course_name = item.select_one("span.course-name")
            link = item.select_one("a[href]")
            if not all((course_id, clazz_id, course_name, link)):
                continue
            cpi_match = re.search(r"(?:[?&])cpi=([0-9]+)(?:&|$)", link.get("href", ""))
            if not cpi_match:
                continue
            cid = course_id.get("value", "")
            clazz = clazz_id.get("value", "")
            cpi = cpi_match.group(1)
            key = f"{cid}:{clazz}:{cpi}"
            try:
                _course_ids(key)
            except ValueError:
                continue
            title = (course_name.get("title") or course_name.get_text(strip=True) or "").strip()[:200]
            if not title or key in seen:
                continue
            seen.add(key)
            courses.append(Course(platform=Platform.XUEXITONG, course_id=key, title=title))
        return courses

    def list_courses(self) -> list[Course]:
        """Include course-folder contents, not only the default root listing.

        A failed folder read is reported as an error instead of presenting an
        incomplete root-only list as a successful full course synchronization.
        """
        html = self._course_html()
        seen: set[str] = set()
        courses = self._parse_courses(html, seen)
        soup = BeautifulSoup(html, "html.parser")
        folder_ids: list[str] = []
        for item in soup.select("ul.file-list > li[fileid]"):
            folder_id = str(item.get("fileid", "")).strip()
            if (folder_id.isascii() and folder_id.isdecimal()
                    and 1 <= len(folder_id) <= 24 and folder_id not in folder_ids):
                folder_ids.append(folder_id)
        if len(folder_ids) > 50:
            raise RuntimeError("XUEXITONG_TOO_MANY_FOLDERS")
        if folder_ids:
            with _session() as session:
                for folder_id in folder_ids:
                    response = session.post(
                        COURSES_URL,
                        data={"courseType": 1, "courseFolderId": folder_id,
                              "query": "", "superstarClass": 0},
                        timeout=(5, 12), allow_redirects=False,
                    )
                    courses.extend(self._parse_courses(_checked(response), seen))
        return courses

    def list_chapters(self, course_key: str, *, session: requests.Session | None = None) -> list[dict[str, Any]]:
        course_id, clazz_id, cpi = _course_ids(course_key)
        owned = session is None
        session = session or _session()
        try:
            response = session.get(CHAPTERS_URL, params={"courseid": course_id, "clazzid": clazz_id, "cpi": cpi, "ut": "s"}, timeout=(5, 14), allow_redirects=False)
            html = _checked(response)
            soup = BeautifulSoup(html, "html.parser")
            result = []
            seen = set()
            for item in soup.select("div.chapter_unit li"):
                node = item.select_one("div[id^=cur]")
                title_node = item.select_one("a.clicktitle")
                chapter_id = (node.get("id") or "")[3:] if node else ""
                if not chapter_id.isdigit() or chapter_id in seen:
                    continue
                seen.add(chapter_id)
                status = item.get_text(" ", strip=True)
                result.append({
                    "id": chapter_id, "title": (title_node.get_text(" ", strip=True) if title_node else f"章节 {len(result) + 1}")[:180],
                    "completed": "已完成" in status, "locked": "解锁" in status and "未解锁" in status,
                })
            return result
        finally:
            if owned:
                session.close()

    def list_chapter_tasks(self, course_key: str, chapter_id: str) -> list[dict[str, Any]]:
        """Read one real chapter's task cards without requesting media tokens.

        This is a bounded, course-scoped metadata operation. It neither
        starts playback nor sends learning-progress reports.
        """
        course_id, clazz_id, cpi = _course_ids(course_key)
        if not isinstance(chapter_id, str) or not re.fullmatch(r"[0-9]{1,24}", chapter_id):
            raise ValueError("INVALID_XUEXITONG_CHAPTER")
        with _session() as session:
            chapters = self.list_chapters(course_key, session=session)
            target = next((item for item in chapters if item["id"] == chapter_id), None)
            if target is None:
                raise LookupError("XUEXITONG_CHAPTER_NOT_FOUND")
            if target["locked"]:
                return []
            result: list[dict[str, Any]] = []
            seen: set[str] = set()
            for card_num in range(7):
                response = session.get(
                    CARDS_URL,
                    params={
                        "clazzid": clazz_id, "courseid": course_id, "knowledgeid": chapter_id,
                        "ut": "s", "cpi": cpi, "v": "2025-0424-1038-3",
                        "mooc2": 1, "num": card_num,
                    },
                    timeout=(5, 12), allow_redirects=False,
                )
                if response.status_code != 200 or response.is_redirect:
                    raise RuntimeError("XUEXITONG_CARDS_UNAVAILABLE")
                data = _embedded_marg(_checked(response))
                if not data:
                    continue
                attachments = data.get("attachments", [])
                if not isinstance(attachments, list):
                    continue
                for index, card in enumerate(attachments):
                    if not isinstance(card, dict):
                        continue
                    kind = str(card.get("type") or "").lower()
                    if kind not in {"video", "audio", "document", "workid", "read", "live"}:
                        continue
                    prop = card.get("property")
                    if not isinstance(prop, dict):
                        prop = {}
                    identifier = str(card.get("jobid") or prop.get("jobid") or
                                     card.get("objectId") or f"{card_num}-{index}")[:160]
                    key = kind + ":" + identifier
                    if key in seen:
                        continue
                    seen.add(key)
                    name = str(prop.get("name") or prop.get("title") or card.get("name")
                               or kind)[:180]
                    result.append({
                        "id": key,
                        "type": kind,
                        "title": name,
                        "chapter_id": chapter_id,
                        "completed": card.get("isPassed") if type(card.get("isPassed")) is bool else None,
                    })
            return result

    def list_video_tasks(self, course_key: str) -> list[VideoTask]:
        course_id, clazz_id, cpi = _course_ids(course_key)
        session = _session()
        try:
            chapters = self.list_chapters(course_key, session=session)
            fid = session.cookies.get("fid", "1024")
            results: list[VideoTask] = []
            for chapter in chapters:
                if chapter["completed"] or chapter["locked"]:
                    continue
                for card_num in range(7):
                    response = session.get(CARDS_URL, params={
                        "clazzid": clazz_id, "courseid": course_id, "knowledgeid": chapter["id"],
                        "ut": "s", "cpi": cpi, "v": "2025-0424-1038-3", "mooc2": 1, "num": card_num,
                    }, timeout=(5, 12), allow_redirects=False)
                    if response.status_code != 200 or response.is_redirect:
                        raise RuntimeError("XUEXITONG_CARDS_UNAVAILABLE")
                    match = re.search(r"\bmArg\s*=\s*(\{.*?\})\s*;", response.text, re.S)
                    if not match:
                        continue
                    try:
                        payload = json.loads(match.group(1))
                    except json.JSONDecodeError:
                        continue
                    defaults = payload.get("defaults") or {}
                    for attachment in payload.get("attachments") or []:
                        if not isinstance(attachment, dict) or attachment.get("isPassed"):
                            continue
                        if str(attachment.get("type", "")).lower() != "video":
                            continue
                        prop = attachment.get("property") or {}
                        object_id = str(attachment.get("objectId") or "")
                        job_id = str(attachment.get("jobid") or prop.get("jobid") or "")
                        if not object_id or not job_id:
                            continue
                        video_response = session.get(STATUS_URL + quote(object_id, safe=""),
                            params={"k": fid, "flag": "normal"}, timeout=(5, 12), allow_redirects=False)
                        if video_response.status_code != 200 or video_response.is_redirect:
                            continue
                        try:
                            info = video_response.json()
                        except ValueError:
                            continue
                        if info.get("status") != "success":
                            continue
                        dtoken = info.get("dtoken")
                        duration = info.get("duration")
                        if not isinstance(dtoken, str) or not isinstance(duration, (int, float)) or duration <= 0:
                            continue
                        results.append(VideoTask(
                            course_key=course_key, chapter_id=chapter["id"], chapter=chapter["title"],
                            title=str(prop.get("name") or prop.get("title") or chapter["title"])[:180],
                            clazz_id=clazz_id, course_id=course_id, cpi=cpi,
                            job_id=job_id, object_id=object_id,
                            other_info=str(attachment.get("otherInfo") or "").split("&")[0][:250],
                            duration=int(duration), initial_seconds=max(0, int(attachment.get("playTime") or 0) // 1000),
                            dtoken=dtoken, rt=float(prop.get("rt") or 0.9),
                            face_enc=str(attachment.get("videoFaceCaptureEnc") or "")[:500],
                            att_duration_enc=str(attachment.get("attDurationEnc") or "")[:500],
                        ))
            return results
        finally:
            session.close()
