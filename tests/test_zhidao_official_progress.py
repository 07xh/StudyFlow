"""Read-only official AI course progress contract; offline evidence only."""
from __future__ import annotations

import ast
import hashlib
from pathlib import Path

from studyflow.platforms.zhidao import legacy_runtime


def test_official_ai_schedule_rejects_invalid_and_stale_values():
    at = "2026-11-15T08:00:00+00:00"
    base = {"courseType": "ai", "officialVerifiedAt": at}
    for value in (True, False, None, -1, 101, "4", float("nan"), float("inf")):
        assert legacy_runtime._official_ai_progress({**base, "officialProgressPercent": value}) is None
    assert legacy_runtime._official_ai_progress({**base, "officialProgressPercent": 4})[:2] == (4.0, at)
    assert legacy_runtime._official_ai_progress({**base, "officialProgressPercent": 0.0})[:2] == (0.0, at)
    assert legacy_runtime._official_ai_progress({**base, "officialProgressPercent": 4, "stale": True}) is None


def test_current_account_prefers_latest_official_schedule_to_completed_points(monkeypatch):
    course = {"courseType": "ai", "courseId": "11", "classId": "21",
              "name": "思政课程", "officialProgressPercent": 4,
              "officialVerifiedAt": "2026-11-15T08:00:00Z"}
    progress = {**course, "officialProgressPercent": 3, "officialVerifiedAt": "2026-11-15T07:59:00Z",
                "knowledgePointCount": 147, "fullProgressPoints": 4,
                "lastVerifiedAt": "2026-11-15T07:59:00Z"}
    monkeypatch.setattr(legacy_runtime, "_progress_cache", lambda fingerprint: {"courses": [progress]})
    result = legacy_runtime._courses_from_current_cache([course], "a" * 64)[0]
    assert result.progress_percent == 4
    assert result.progress_metric == "official_ai_schedule"
    assert result.progress_evidence == "server_verified"
    assert result.verified_at == "2026-11-15T08:00:00Z"
    assert result.session_marker == hashlib.sha256(
        ("studyflow-ui-progress:" + "a" * 64).encode()).hexdigest()


def test_latest_single_course_server_schedule_wins_over_old_course_list(monkeypatch):
    course = {"courseType": "ai", "courseId": "11", "classId": "21", "name": "思政课程",
              "officialProgressPercent": 4, "officialVerifiedAt": "2026-11-15T07:59:00Z"}
    progress = {**course, "officialProgressPercent": 5, "officialVerifiedAt": "2026-11-15T08:00:00Z",
                "knowledgePointCount": 147, "fullProgressPoints": 4,
                "lastVerifiedAt": "2026-11-15T08:00:00Z"}
    monkeypatch.setattr(legacy_runtime, "_progress_cache", lambda fingerprint: {"courses": [progress]})
    result = legacy_runtime._courses_from_current_cache([course], "a" * 64)[0]
    assert result.progress_percent == 5
    assert result.progress_metric == "official_ai_schedule"


def test_fallback_is_explicitly_knowledge_completion_not_official(monkeypatch):
    course = {"courseType": "ai", "courseId": "11", "classId": "21", "name": "思政课程"}
    progress = {**course, "knowledgePointCount": 147, "fullProgressPoints": 4,
                "lastVerifiedAt": "2026-11-15T08:00:00Z"}
    monkeypatch.setattr(legacy_runtime, "_progress_cache", lambda fingerprint: {"courses": [progress]})
    result = legacy_runtime._courses_from_current_cache([course], "a" * 64)[0]
    assert result.progress_percent == round(400 / 147, 1)
    assert result.progress_metric == "knowledge_point_full"


def test_reader_source_remains_read_only_and_parses_schedule_without_cookies():
    source = Path(__file__).resolve().parents[1] / "src" / "studyflow" / "platforms" / "zhidao" / "upstream" / "zhidao_only.py"
    text = source.read_text(encoding="utf-8")
    ast.parse(text, filename=str(source))
    assert 'schedule = row.get("schedule")' in text
    assert 'item["officialProgressPercent"]' in text
    assert 'item["officialVerifiedAt"]' in text
    assert 'updated_ai = read_with_retry(lambda: ai_course_list(session))' in text
