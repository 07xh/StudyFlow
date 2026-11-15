"""Read-only Rain Classroom metadata extracted from the user's legacy code.

No import of upstream main.py: it redirects stdout/stderr at import time.
No video progress submission or synthetic watching is exposed.
"""
from __future__ import annotations

from typing import Any
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
        )
        response.raise_for_status()
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
