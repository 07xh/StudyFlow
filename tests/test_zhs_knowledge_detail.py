"""ZHS authenticated AI knowledge detail is read-only, not a heartbeat."""
from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace as NS

import pytest

from studyflow.platforms.zhidao.zhs_knowledge_detail import (
    _plain_text, official_catalog_entry, read_knowledge_detail,
)


def test_text_sanitizer_discards_scripts_and_embedded_markup():
    assert _plain_text("<p>课程详情</p><script>secret()</script><div>学习内容</div>") == "课程详情\n\n学习内容"
    assert _plain_text(None) == ""
    assert _plain_text("plain") == "plain"


def test_catalog_entry_does_not_assume_empty_resources_are_completed():
    entry = {"knowledgeId": "87", "resourceCount": 0, "finishedResourceCount": 0}
    assert official_catalog_entry({"themeList": [{"subThemeList": [
        {"knowledgeList": [entry]}
    ]}]}, 87) == entry
    assert official_catalog_entry({"themeList": [{"subThemeList": [
        {"knowledgeList": [entry]}
    ]}]}, 88) is None


def install_mock_zhs(monkeypatch, *, resource_count=0, finished_count=0, main_content=None, desktop_unavailable=False):
    zhs = ModuleType("zhs")
    zhs.__path__ = []
    cli = ModuleType("zhs.cli")
    cli.__path__ = []
    bootstrap = ModuleType("zhs.cli.bootstrap")
    ai = ModuleType("zhs.ai")
    ai.__path__ = []
    course_module = ModuleType("zhs.ai.course")
    events = []
    session = NS(urls=NS(ai="https://kg-ai-run.zhihuishu.com",
                         ai_task="https://kg-run-student.zhihuishu.com"),
                 close=lambda: events.append("close"))
    bootstrap.load_config_and_session = lambda **_kwargs: (None, session)

    class Manager:
        def __init__(self, current_session):
            assert current_session is session

        def get_knowledge_points(self, cid, cls):
            events.append(("read_points", cid, cls))
            return NS(cake_theme_list=[NS(knowledge_list=[
                NS(knowledge_id=87, knowledge_name="历任校首", study_progress=32)
            ])])

        def _ai_query(self, url, params):
            events.append(("read", url.rsplit("/", 1)[-1], dict(params)))
            if url.endswith("/get-map-tree-node-detail") and desktop_unavailable:
                raise RuntimeError("not available on this course")
            if url.endswith("/get-map-tree-node-detail") or url.endswith("/get-map-tree-node-detail-with-mastery"):
                return {"code": 200, "data": {
                    "nodeUid": "87", "nodeName": "历任校首",
                    "mainContent": main_content,
                    "knowledgeDescList": [{"itemName": ""}],
                }}
            if url.endswith("/get-course-knowledge-dic") and desktop_unavailable:
                raise RuntimeError("not available on this course")
            if url.endswith("/get-course-knowledge-dic-wx-three"):
                # Mobile 2026 HAR: no resource-count fields, but it does
                # provide an independently read 0/100 studyProgress.
                return {"code": 200, "data": {"themeList": [{"subThemeList": [
                    {"knowledgeList": [{"knowledgeId": "87", "studyProgress": 100}]}
                ]}]}}
            if url.endswith("/get-course-knowledge-dic"):
                return {"code": 200, "data": {"themeList": [{"subThemeList": [
                    {"knowledgeList": [{"knowledgeId": "87", "resourceCount": resource_count,
                                       "finishedResourceCount": finished_count}]}
                ]}]}}
            raise AssertionError("unexpected mutation or unrecognized URL: " + url)

        def list_knowledge_resources(self, cid, cls, kid):
            events.append(("read_resources", cid, cls, kid))
            return []

    course_module.AiCourseManager = Manager
    for key, value in [
        ("zhs", zhs), ("zhs.cli", cli), ("zhs.cli.bootstrap", bootstrap),
        ("zhs.ai", ai), ("zhs.ai.course", course_module),
    ]:
        monkeypatch.setitem(sys.modules, key, value)
    from studyflow.platforms.zhidao import legacy_runtime
    monkeypatch.setattr(legacy_runtime, "resolve_course",
                        lambda key: {"course_type": "ai", "course_id": "88", "class_id": "99"})
    return events


def test_zhs_detail_reads_genuine_metadata_without_any_heartbeat(monkeypatch):
    events = install_mock_zhs(monkeypatch, main_content="<p>真实图文知识点</p>")
    detail = read_knowledge_detail("a" * 64, 87)
    assert detail["knowledge_id"] == "87"
    assert detail["name"] == "历任校首"
    assert detail["content"] == "真实图文知识点"
    assert detail["content_available"] is True
    assert detail["official_resource_count"] == 0
    assert detail["official_finished_resource_count"] == 0
    assert detail["catalog_mismatch"] is False
    assert detail["knowledge_progress_percent"] == 32
    assert detail["verification"] == "read_only"
    assert detail["study_record_submitted"] is False
    assert [event[1] for event in events if isinstance(event, tuple) and event[0] == "read"] == [
        "get-map-tree-node-detail", "get-course-knowledge-dic"
    ]
    assert events[-1] == "close"


def test_zhs_detail_reports_catalog_inconsistency_and_null_body(monkeypatch):
    events = install_mock_zhs(monkeypatch, resource_count=4, finished_count=2)
    detail = read_knowledge_detail("a" * 64, 87)
    assert detail["content_available"] is False
    assert detail["catalog_mismatch"] is True
    assert detail["official_resource_count"] == 4
    assert detail["listed_resource_count"] == 0
    assert events[-1] == "close"


def test_zhs_detail_rejects_invalid_knowledge_ids_before_network():
    with pytest.raises(ValueError, match="INVALID_KNOWLEDGE_ID"):
        read_knowledge_detail("a" * 64, True)
    with pytest.raises(ValueError, match="INVALID_KNOWLEDGE_ID"):
        read_knowledge_detail("a" * 64, 0)


def test_zhs_detail_ipc_is_scoped_and_reports_only_readonly_evidence(monkeypatch):
    from studyflow.services import bridge
    expected = {"verification": "read_only", "study_record_submitted": False}
    calls = []
    monkeypatch.setattr(bridge, "read_zhs_knowledge_detail",
                        lambda course_key, knowledge_id:
                        (calls.append((course_key, knowledge_id)) or expected))
    request = {"id": "detail-read-1", "version": 1,
               "operation": "zhidao.zhs.knowledge.detail",
               "course_key": "a" * 64, "knowledge_id": "1876171149646368768"}
    response = bridge.dispatch(request)
    assert response == {"id": "detail-read-1", "ok": True, "data": expected}
    assert calls == [("a" * 64, 1876171149646368768)]
    for invalid in (0, -2, True, 87, 2**64, "", "0", "-1", "01", "9"*20, "abc"):
        response = bridge.dispatch({**request, "knowledge_id": invalid})
        assert response["ok"] is False
        assert response["error"] == "INVALID_REQUEST"
    assert len(calls) == 1


def test_mobile_2026_detail_fallback_uses_read_only_api_without_resource_count(monkeypatch):
    events = install_mock_zhs(monkeypatch, desktop_unavailable=True,
                              main_content=None)
    detail = read_knowledge_detail("a" * 64, 87)
    assert detail["detail_source"] == "mobile"
    assert detail["catalog_source"] == "mobile"
    assert detail["official_resource_count"] is None
    assert detail["official_finished_resource_count"] is None
    assert detail["mobile_knowledge_progress_percent"] == 100
    assert detail["knowledge_progress_percent"] == 32
    assert detail["study_record_submitted"] is False
    calls = [event[1] for event in events if isinstance(event, tuple) and event[0] == "read"]
    assert calls == ["get-map-tree-node-detail",
                     "get-map-tree-node-detail-with-mastery",
                     "get-course-knowledge-dic",
                     "get-course-knowledge-dic-wx-three"]
    assert events[-1] == "close"
