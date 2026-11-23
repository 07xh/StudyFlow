"""Read-only Rain Classroom metadata extracted from the user's legacy code.

No import of upstream main.py: it redirects stdout/stderr at import time.
No video progress submission or synthetic watching is exposed.
"""
from __future__ import annotations

from typing import Any
import math
import requests

BASE_URL = "https://changjiang.yuketang.cn"


class YuketangReadOnly:
    def __init__(self, cookies: dict[str, str], *, session: requests.Session | None = None,
                 university_id: str = "", csrf_token: str = ""):
        if not cookies:
            raise ValueError("Authenticated cookies are required")
        self.session = session or requests.Session()
        self.session.cookies.update(cookies)
        self.university_id = university_id
        self.csrf_token = csrf_token

    def _get(self, path: str, params: dict[str, Any], classroom_id: str) -> dict[str, Any]:
        response = self.session.get(
            BASE_URL + path, params=params, timeout=(5, 15),
            headers={
                "Accept": "application/json, text/plain, */*",
                "Xt-Agent": "web", "classroom-id": classroom_id,
                "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": self.csrf_token,
                "platform-id": "3", "terminal-type": "web", "university-id": self.university_id,
                "x-client": "web", "xtbz": "ykt",
            },
            allow_redirects=False,
        )
        if response.status_code != 200:
            # Redirects and authentication failures are not verified API data.
            raise ValueError("Unverified Rain Classroom metadata response")
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("Invalid Rain Classroom response")
        return data

    def classroom_info(self, classroom_id: str) -> dict[str, Any]:
        return self._get("/mooc-api/v1/lms/learn/classroom_info/",
                         {"classroom_id": classroom_id}, classroom_id)

    def chapters(self, classroom_id: str, *, sign: str | None = None,
                 uv_id: str = "") -> dict[str, Any]:
        params: dict[str, Any] = {"cid": classroom_id, "term": "latest",
                                  "uv_id": uv_id, "classroom_id": classroom_id}
        if sign:
            params["sign"] = sign
        return self._get("/mooc-api/v1/lms/learn/course/chapter", params, classroom_id)

    def video_metadata(self, classroom_id: str, *, sign: str | None = None,
                       uv_id: str = "") -> list[dict[str, str]]:
        """Read real video leaves from both nested and direct chapter layouts.

        Never infer an ID from leafinfo_id or a generic section: only leaves
        explicitly typed as video are returned. No completion is fabricated.
        """
        response = self.chapters(classroom_id, sign=sign, uv_id=uv_id)
        if response.get("success") is not True:
            raise RuntimeError("Rain Classroom chapters unavailable")
        data = response.get("data")
        chapters = data.get("course_chapter") if isinstance(data, dict) else None
        if not isinstance(chapters, list):
            raise ValueError("Invalid chapter list")

        videos: list[dict[str, str]] = []
        seen: set[str] = set()

        def add_video(leaf: dict[str, Any], chapter_name: str,
                      fallback_name: str) -> None:
            kind = leaf.get("leaf_type")
            if type(kind) is not int and kind != "0":
                return
            if kind not in (0, "0"):
                return
            identifier = leaf.get("id")
            if isinstance(identifier, bool) or not isinstance(identifier, (int, str)):
                return
            leaf_id = str(identifier).strip()
            if not leaf_id or leaf_id in seen:
                return
            seen.add(leaf_id)
            videos.append({
                "id": leaf_id,
                "name": str(leaf.get("name") or fallback_name or "视频")[:200],
                "chapter": chapter_name[:160],
            })

        for chapter in chapters:
            if not isinstance(chapter, dict):
                continue
            chapter_name = str(chapter.get("name") or "未命名章节")
            sections = chapter.get("section_leaf_list")
            if not isinstance(sections, list):
                continue
            for section in sections:
                if not isinstance(section, dict):
                    continue
                section_name = str(section.get("name") or "视频")
                leaves = section.get("leaf_list")
                if isinstance(leaves, list) and leaves:
                    for leaf in leaves:
                        if isinstance(leaf, dict):
                            add_video(leaf, chapter_name, section_name)
                else:
                    # Some classroom versions put a video directly in a section.
                    add_video(section, chapter_name, section_name)
        return videos


    @staticmethod
    def _positive_id(value: object) -> str | None:
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            return None
        number = str(value)
        return number if number.isascii() and number.isdecimal() and 1 <= len(number) <= 24 and int(number) > 0 else None

    @staticmethod
    def _nonnegative_number(value: object) -> float | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        number = float(value)
        return number if math.isfinite(number) and 0 <= number <= 1_000_000 else None

    def read_video_progress(self, classroom_id: str, leaf_id: str) -> dict[str, float | bool | None]:
        """Read one original Rain Classroom video's server progress, without a heartbeat.

        The chapter leaf identifier is used only after leaf_info verifies the
        current classroom and returns user/course IDs. Never guess IDs from
        a section, a cookie, or a cached local playback position.
        """
        classroom = self._positive_id(classroom_id)
        leaf = self._positive_id(leaf_id)
        if classroom is None or leaf is None:
            raise ValueError("Invalid classroom/video identifier")
        leaf_info = self._get(
            f"/mooc-api/v1/lms/learn/leaf_info/{classroom}/{leaf}/", {}, classroom
        )
        if leaf_info.get("success") is not True or not isinstance(leaf_info.get("data"), dict):
            raise ValueError("Unverified Rain Classroom leaf")
        data = leaf_info["data"]
        user_id = self._positive_id(data.get("user_id"))
        course_id = self._positive_id(data.get("course_id"))
        declared_classroom = data.get("classroom_id")
        if declared_classroom is not None and self._positive_id(declared_classroom) != classroom:
            raise ValueError("Leaf belongs to another classroom")
        if user_id is None or course_id is None:
            raise ValueError("Leaf lacks authenticated user/course identifiers")

        # This is the exact read-only progress endpoint and query shape used
        # in the preserved Rain Classroom main.py. No heartbeat/write endpoint.
        response = self.session.get(
            BASE_URL + "/video-log/get_video_watch_progress/",
            params={"cid": course_id, "user_id": user_id, "classroom_id": classroom,
                    "video_type": "video", "vtype": "rate",
                    "video_id": leaf, "snapshot": 1},
            headers={
                "Accept": "application/json, text/plain, */*",
                "Xt-Agent": "web", "classroom-id": classroom,
                "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": self.csrf_token,
                "Cache-Control": "no-cache, no-store", "Pragma": "no-cache",
                "university-id": self.university_id, "uv-id": self.university_id,
                "xtbz": "ykt",
            },
            timeout=(5, 10), allow_redirects=False,
        )
        if response.status_code != 200:
            raise ValueError("No authenticated progress response")
        payload = response.json()
        if not isinstance(payload, dict) or str(payload.get("code")) != "0":
            raise ValueError("Server did not confirm progress")
        records = payload.get("data")
        if not isinstance(records, dict):
            raise ValueError("Server progress data unavailable")
        record = records.get(leaf)
        if not isinstance(record, dict):
            raise ValueError("Video has no server-confirmed progress")
        raw_rate = record.get("rate")
        if isinstance(raw_rate, bool) or not isinstance(raw_rate, (int, float)):
            raise ValueError("Invalid server progress rate")
        rate = float(raw_rate)
        if not math.isfinite(rate) or not 0 <= rate <= 1:
            raise ValueError("Invalid server progress rate")
        last_position = self._nonnegative_number(record.get("last_point"))
        duration = None
        for candidate in (data.get("duration"), (data.get("content_info") or {}).get("media", {}).get("duration")
                          if isinstance(data.get("content_info"), dict)
                          and isinstance(data["content_info"].get("media"), dict) else None):
            number = self._nonnegative_number(candidate)
            if number is not None and number > 0:
                duration = number
                break
        percent = round(rate * 100, 1)
        if rate < 1.0 and percent >= 100.0:
            percent = 99.9
        # Rain Classroom exposes both a playback coverage rate and an explicit
        # server completion flag on a video's progress record. They may differ.
        # Honor only documented 0/1-shaped values; do not guess from a timestamp
        # or the local worker's configurable completion threshold.
        flag = record.get("completed")
        if flag is True or flag == 1 or flag == "1":
            completed = True
        elif flag is False or flag == 0 or flag == "0":
            completed = False
        else:
            # Older deployments may omit the flag; retain the original strict
            # fallback to an exact 100% server rate in that case.
            completed = rate == 1.0
        return {"progress_percent": percent, "server_completed": completed,
                "last_point_seconds": last_position,
                "duration_seconds": duration}
