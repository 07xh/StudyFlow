"""Read-only AI knowledge detail and official resource counters for ZHS mode.

This is NOT a video heartbeat, completion RPC or fake study session. It reads
the authenticated server catalog and detail page using the bundled ZHS crypto
and the user's own session, then reports only observable server evidence.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any


class _ReadableText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self.hidden += 1
        if not self.hidden and tag in ("p", "br", "div", "li", "tr", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1
        if not self.hidden and tag in ("p", "div", "li", "tr"):
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def _plain_text(source: Any, limit: int = 12000) -> str:
    if not isinstance(source, str):
        return ""
    parser = _ReadableText()
    # Do not parse more than a bounded response; script/style are never shown.
    parser.feed(source[:limit * 4])
    text = "".join(parser.parts)
    text = re.sub(r"[\t\r ]+", " ", text)
    text = re.sub(r"\n[\n ]*\n+", "\n\n", text)
    return text.strip()[:limit]


def _integer(value: Any) -> int | None:
    if type(value) is int and 0 <= value <= 2**63 - 1:
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,19}", value):
        return int(value)
    return None


def official_catalog_entry(payload: Any, knowledge_id: int) -> dict | None:
    """Locate a real node in the official learning directory, never assume 0/0 = done."""
    if not isinstance(payload, dict) or not isinstance(payload.get("themeList"), list):
        return None
    for theme in payload["themeList"][:1000]:
        if not isinstance(theme, dict):
            continue
        for sub in theme.get("subThemeList", [])[:2000]:
            if not isinstance(sub, dict):
                continue
            for entry in sub.get("knowledgeList", [])[:5000]:
                if isinstance(entry, dict) and _integer(entry.get("knowledgeId")) == knowledge_id:
                    return entry
    return None


def _counts(entry: dict | None) -> tuple[int | None, int | None]:
    if not isinstance(entry, dict):
        return None, None
    total = _integer(entry.get("resourceCount"))
    finished = _integer(entry.get("finishedResourceCount"))
    if total is None or finished is None or finished > total:
        return None, None
    return total, finished


def read_knowledge_detail(course_key: str, knowledge_id: int) -> dict:
    """Read one validated knowledge node via ZHS' own signed session.

    Does not send study logs, resource completion, play/pause, or heartbeat.
    """
    from studyflow.platforms.zhidao.legacy_runtime import resolve_course
    from zhs.cli.bootstrap import load_config_and_session
    from zhs.ai.course import AiCourseManager

    if type(knowledge_id) is not int or not 0 < knowledge_id <= 2**63 - 1:
        raise ValueError("INVALID_KNOWLEDGE_ID")
    course = resolve_course(course_key)
    if course["course_type"] != "ai":
        raise ValueError("INVALID_KNOWLEDGE_ID")
    cid, class_id = int(course["course_id"]), int(course["class_id"])

    loaded = load_config_and_session(debug=False, console_log=False, proxy=None)
    if loaded is None:
        raise RuntimeError("LOGIN_REQUIRED")
    _, session = loaded
    try:
        manager = AiCourseManager(session)
        catalog = manager.get_knowledge_points(cid, class_id)
        points = [point for theme in catalog.cake_theme_list
                  for point in theme.knowledge_list
                  if point.knowledge_id == knowledge_id]
        if len(points) != 1:
            raise RuntimeError("KNOWLEDGE_NOT_FOUND")
        point = points[0]

        # This endpoint and these exact parameters are evidenced by the user's
        # own HAR and its captured official client code. _ai_query uses the
        # pinned ZHS 0.1.5 authentication/encryption stack unchanged.
        url = f"{session.urls.ai}/run/gateway/t/stu/maptree/get-map-tree-node-detail"
        detail_response = manager._ai_query(url, {
            "courseId": cid, "classId": class_id, "knowledgeId": knowledge_id,
        })
        detail = detail_response.get("data") if isinstance(detail_response, dict) else None
        if not isinstance(detail, dict) or _integer(detail.get("nodeUid")) != knowledge_id:
            raise RuntimeError("KNOWLEDGE_DETAIL_UNAVAILABLE")

        directory = manager._ai_query(
            f"{session.urls.ai}/run/gateway/t/stu/knowledge-study/get-course-knowledge-dic",
            {"courseId": cid, "classId": class_id},
        )
        catalog_data = directory.get("data") if isinstance(directory, dict) else None
        entry = official_catalog_entry(catalog_data, knowledge_id)
        resource_count, finished_count = _counts(entry)
        resources = manager.list_knowledge_resources(cid, class_id, knowledge_id)
        # A server resource-list mismatch must not be silently reported as
        # "there is nothing to study".
        mismatch = resource_count is not None and resource_count != len(resources)

        chunks: list[str] = []
        body = _plain_text(detail.get("mainContent"))
        if body:
            chunks.append(body)
        for item in (detail.get("knowledgeDescList") or [])[:80]:
            if isinstance(item, dict):
                part = _plain_text(item.get("itemName"), limit=1000)
                if part:
                    chunks.append(part)
        content = "\n\n".join(chunks)[:12000]

        name = str(detail.get("nodeName") or point.knowledge_name)
        if not name or len(name) > 200 or any(ord(c) < 32 for c in name):
            name = str(point.knowledge_name)[:200]
        return {
            "course_key": course_key,
            "knowledge_id": knowledge_id,
            "name": name,
            "content": content,
            "content_available": bool(content),
            "detail_metadata_present": bool(detail.get("knowledgeDescList") or detail.get("mainContent")),
            "listed_resource_count": len(resources),
            "official_resource_count": resource_count,
            "official_finished_resource_count": finished_count,
            "catalog_mismatch": mismatch,
            "knowledge_progress_percent": max(0, min(100, int(point.study_progress))),
            "verification": "read_only",
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "study_record_submitted": False,
        }
    finally:
        session.close()
