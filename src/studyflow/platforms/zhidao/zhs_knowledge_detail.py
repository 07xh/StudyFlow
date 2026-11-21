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
        parsed = int(value)
        return parsed if parsed <= 2**63 - 1 else None
    return None


def official_catalog_entry(payload: Any, knowledge_id: int) -> dict | None:
    """Locate a real node in the official learning directory, never assume 0/0 = done."""
    if not isinstance(payload, dict) or not isinstance(payload.get("themeList"), list):
        return None
    for theme in payload["themeList"][:1000]:
        if not isinstance(theme, dict):
            continue
        subthemes = theme.get("subThemeList")
        if not isinstance(subthemes, list):
            continue
        for sub in subthemes[:2000]:
            if not isinstance(sub, dict):
                continue
            knowledge = sub.get("knowledgeList")
            if not isinstance(knowledge, list):
                continue
            for entry in knowledge[:5000]:
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
    # Validate untrusted UI parameters before importing the optional bundled
    # ZHS runtime, so malformed requests cannot launch a network client.
    if type(knowledge_id) is not int or not 0 < knowledge_id <= 2**63 - 1:
        raise ValueError("INVALID_KNOWLEDGE_ID")
    from studyflow.platforms.zhidao.legacy_runtime import resolve_course
    course = resolve_course(course_key)
    if course["course_type"] != "ai":
        raise ValueError("INVALID_KNOWLEDGE_ID")
    cid, class_id = int(course["course_id"]), int(course["class_id"])
    from zhs.cli.bootstrap import load_config_and_session
    from zhs.ai.course import AiCourseManager

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

        # Desktop and mobile AI pages use different *read-only* endpoints.
        # Use ZHS' existing authenticated query transport in both cases.
        # A response is accepted only when its nodeUid matches this course's
        # already verified knowledge ID; never infer success from HTTP 200.
        detail = None
        detail_source = None
        detail_params = {"courseId": cid, "classId": class_id, "knowledgeId": knowledge_id}
        for source, url in (
            ("desktop", f"{session.urls.ai}/run/gateway/t/stu/maptree/get-map-tree-node-detail"),
            ("mobile", f"{session.urls.ai_task}/student/gateway/t/stu/maptree/get-map-tree-node-detail-with-mastery"),
        ):
            try:
                result = manager._ai_query(url, detail_params)
                candidate = result.get("data") if isinstance(result, dict) else None
                if isinstance(candidate, dict) and _integer(candidate.get("nodeUid")) == knowledge_id:
                    detail, detail_source = candidate, source
                    break
            except Exception:
                # Unsupported deployment or unauthenticated mobile endpoint;
                # the original video playback remains unaffected.
                continue
        if detail is None:
            raise RuntimeError("KNOWLEDGE_DETAIL_UNAVAILABLE")

        entry = None
        catalog_source = None
        for source, url in (
            ("desktop", f"{session.urls.ai}/run/gateway/t/stu/knowledge-study/get-course-knowledge-dic"),
            ("mobile", f"{session.urls.ai_task}/student/gateway/t/stu/knowledge-study/get-course-knowledge-dic-wx-three"),
        ):
            try:
                result = manager._ai_query(url, {"courseId": cid, "classId": class_id})
                data = result.get("data") if isinstance(result, dict) else None
                candidate = official_catalog_entry(data, knowledge_id)
                if candidate is not None:
                    entry, catalog_source = candidate, source
                    break
            except Exception:
                continue
        resource_count, finished_count = _counts(entry)
        mobile_progress = _integer(entry.get("studyProgress")) if catalog_source == "mobile" else None
        if mobile_progress is not None and mobile_progress > 100:
            mobile_progress = None
        resources = manager.list_knowledge_resources(cid, class_id, knowledge_id)
        # A server resource-list mismatch must not be silently reported as
        # "there is nothing to study".
        mismatch = resource_count is not None and resource_count != len(resources)

        chunks: list[str] = []
        body = _plain_text(detail.get("mainContent"))
        if body:
            chunks.append(body)
        descriptions = detail.get("knowledgeDescList")
        if not isinstance(descriptions, list):
            descriptions = []
        for item in descriptions[:80]:
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
            "knowledge_id": str(knowledge_id),
            "name": name,
            "content": content,
            "content_available": bool(content),
            "detail_metadata_present": bool(descriptions or detail.get("mainContent")),
            "listed_resource_count": len(resources),
            "official_resource_count": resource_count,
            "official_finished_resource_count": finished_count,
            "catalog_mismatch": mismatch,
            "catalog_source": catalog_source,
            "detail_source": detail_source,
            # Mobile 2026 directory contains per-knowledge studyProgress but
            # does not include resourceCount/finishedResourceCount. Distinguish
            # its independently reported value from the desktop snapshot.
            "mobile_knowledge_progress_percent": mobile_progress,
            "knowledge_progress_percent": max(0, min(100, int(point.study_progress))),
            "verification": "read_only",
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "study_record_submitted": False,
        }
    finally:
        session.close()
