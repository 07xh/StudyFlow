"""Isolated, read-only Rain Classroom metadata API.

This module does not import the upstream monolith or modify stdout.
No progress reporting, synthetic playback or heartbeat sending.
"""
from __future__ import annotations
from typing import Any
import requests

BASE_URL = "https://changjiang.yuketang.cn"

class YuketangReadOnly:
    def __init__(self, cookies: dict[str, str], *, session: requests.Session | None = None):
        if not cookies:
            raise ValueError("Authenticated cookies are required")
        self.session = session or requests.Session()
        self.session.cookies.update(cookies)

    def _get(self, path: str, params: dict[str, Any], classroom_id: str) -> dict[str, Any]:
        response = self.session.get(
            BASE_URL + path, params=params, timeout=(5, 15),
            headers={"Accept": "application/json", "Xt-Agent": "web",
                     "classroom-id": classroom_id, "X-Requested-With": "XMLHttpRequest"},
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("Invalid response envelope")
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
        response = self.chapters(classroom_id, sign=sign, uv_id=uv_id)
        if response.get("success") is not True:
            raise RuntimeError("Rain Classroom chapters unavailable")
        chapters = response.get("data", {}).get("course_chapter")
        if not isinstance(chapters, list):
            raise ValueError("Invalid chapter list")
        videos: list[dict[str, str]] = []
        for chapter in chapters:
            if not isinstance(chapter, dict):
                continue
            for section in chapter.get("section_leaf_list", []):
                if not isinstance(section, dict):
                    continue
                for leaf in section.get("leaf_list", []):
                    if isinstance(leaf, dict) and leaf.get("leaf_type") == 0 and leaf.get("id") is not None:
                        videos.append({"id": str(leaf["id"]),
                                       "name": str(leaf.get("name") or section.get("name") or "视频"),
                                       "chapter": str(chapter.get("name") or "")})
        return videos
