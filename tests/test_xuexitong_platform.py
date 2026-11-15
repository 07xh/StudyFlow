"""Offline regression tests: only representative source snippets, never mock courses in production."""
from __future__ import annotations

import json

import pytest

from studyflow.core.models import Platform
from studyflow.platforms.xuexitong import adapter, credentials, settings
from studyflow.services import bridge


class Response:
    status_code = 200
    is_redirect = False

    def __init__(self, body: str):
        self.text = body


class Session:
    def __init__(self, chapter_html: str, card_html: str):
        self.chapter_html = chapter_html
        self.card_html = card_html
        self.calls = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.closed = True

    def get(self, url, *, params, **_kwargs):
        self.calls.append((url, dict(params)))
        if url == adapter.CHAPTERS_URL:
            return Response(self.chapter_html)
        if url == adapter.CARDS_URL:
            return Response(self.card_html if params["num"] == 0 else 'mArg={"attachments":[]};')
        raise AssertionError("Unexpected request")


CHAPTER_HTML = (
    '<div class="chapter_unit"><li>'
    '<div id="cur42"><a class="clicktitle">第一节</a></div>'
    '</li></div>'
)


def test_cookie_validation_does_not_expose_values():
    assert credentials.parse_cookie_header("_uid=123; fid=456") == {"_uid": "123", "fid": "456"}
    with pytest.raises(ValueError):
        credentials.parse_cookie_header("SESSION=unidentified")
    with pytest.raises(ValueError):
        credentials.parse_cookie_header("_uid=123\r\nx: bad")


def test_course_reading_uses_real_html_and_not_placeholder(monkeypatch):
    page = (
        '<div class="course" id="course1" info="some" roleid="1">'
        '<input class="courseId" value="9"/>'
        '<input class="clazzId" value="8"/>'
        '<span class="course-name" title="电路基础"></span>'
        '<a href="/course?cpi=7&abc=1">进入课程</a>'
        '</div>'
    )
    client = adapter.XuexitongAdapter()
    monkeypatch.setattr(client, "_course_html", lambda: page)
    courses = client.list_courses()
    assert len(courses) == 1
    assert courses[0].course_id == "9:8:7"
    assert courses[0].platform == Platform.XUEXITONG
    assert courses[0].title == "电路基础"
    assert courses[0].progress_percent is None
    monkeypatch.setattr(client, "_course_html", lambda: "")
    assert client.list_courses() == []


def test_nested_marg_object_can_contain_quoted_brace():
    payload = {"attachments": [
        {"type": "video", "jobid": "12", "isPassed": False,
         "property": {"name": '视频含 "引号" } 与花括号'}}
    ], "defaults": {"time": 60}}
    page = "var mArg=" + json.dumps(payload, ensure_ascii=False) + ";"
    assert adapter._embedded_marg(page) == payload
    assert adapter._embedded_marg("var nothing = {};") is None


def test_chapter_tasks_are_scoped_and_hide_credentials(monkeypatch):
    payload = {"attachments": [
        {"type": "video", "jobid": "12", "isPassed": False,
         "property": {"name": "视频学习"}},
        {"type": "document", "jobid": "13", "isPassed": True,
         "property": {"name": "课件"}},
        {"type": "workid", "jobid": "14", "isPassed": False,
         "property": {"name": "章节测验"}},
    ]}
    fake = Session(CHAPTER_HTML, "mArg=" + json.dumps(payload, ensure_ascii=False) + ";")
    monkeypatch.setattr(adapter, "_session", lambda: fake)
    result = adapter.XuexitongAdapter().list_chapter_tasks("9:8:7", "42")
    assert [item["type"] for item in result] == ["video", "document", "workid"]
    assert result[1]["completed"] is True
    assert not any("cookie" in str(item).lower() or "dtoken" in str(item).lower() for item in result)
    assert sum(url == adapter.CARDS_URL for url, _ in fake.calls) == 7
    assert fake.closed


def test_missing_completion_flag_remains_unknown(monkeypatch):
    payload = {"attachments": [
        {"type": "read", "jobid": "21", "property": {"name": "阅读材料"}},
        {"type": "video", "jobid": "22", "isPassed": False,
         "property": {"name": "未完成视频"}},
    ]}
    fake = Session(CHAPTER_HTML, "mArg=" + json.dumps(payload, ensure_ascii=False) + ";")
    monkeypatch.setattr(adapter, "_session", lambda: fake)
    result = adapter.XuexitongAdapter().list_chapter_tasks("9:8:7", "42")
    assert [item["completed"] for item in result] == [None, False]


def test_rejects_chapter_not_in_course(monkeypatch):
    fake = Session(CHAPTER_HTML, "")
    monkeypatch.setattr(adapter, "_session", lambda: fake)
    with pytest.raises(LookupError):
        adapter.XuexitongAdapter().list_chapter_tasks("9:8:7", "999")
    assert all(url != adapter.CARDS_URL for url, _ in fake.calls)


def test_xuexitong_settings_persist_and_validate(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    desired = {
        "playback_speed": 1.5, "concurrency": 2,
        "skip_completed": True, "verify_after_run": False,
    }
    assert settings.save(desired) == desired
    assert settings.read() == desired
    with pytest.raises(ValueError):
        settings.save({**desired, "concurrency": True})
    with pytest.raises(ValueError):
        settings.save({**desired, "playback_speed": 99})
    assert settings.read() == desired


def test_bridge_routes_new_platform_calls_without_heartbeat(monkeypatch):
    class Stub:
        def list_chapter_tasks(self, course_key, chapter_id):
            assert (course_key, chapter_id) == ("9:8:7", "42")
            return [{"type": "document", "id": "document:1", "title": "课件",
                     "chapter_id": "42", "completed": False}]
    monkeypatch.setitem(bridge.ADAPTERS, "xuexitong", Stub())
    reply = bridge.dispatch({
        "id": "x1", "version": 1,
        "operation": "xuexitong.chapter.tasks",
        "course_id": "9:8:7", "chapter_id": "42",
    })
    assert reply["ok"] is True
    assert reply["data"][0]["type"] == "document"
    bad = bridge.dispatch({
        "id": "x2", "version": 1,
        "operation": "xuexitong.chapter.tasks",
        "course_id": "invalid", "chapter_id": "42",
    })
    assert bad["ok"] is False


def test_bridge_settings_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    saved = bridge.dispatch({
        "id": "x3", "version": 1, "operation": "xuexitong.settings.save",
        "settings": {"playback_speed": 1.25, "concurrency": 3,
                     "skip_completed": True, "verify_after_run": True}
    })
    assert saved["ok"]
    assert bridge.dispatch({
        "id": "x4", "version": 1,
        "operation": "xuexitong.settings.get",
    })["data"]["concurrency"] == 3


def _course_card(course_id: int, clazz_id: int, cpi: int, title: str) -> str:
    return (
        '<div class="course">'
        f'<input class="courseId" value="{course_id}"/>'
        f'<input class="clazzId" value="{clazz_id}"/>'
        f'<span class="course-name" title="{title}"></span>'
        f'<a href="/course?cpi={cpi}">课程</a>'
        '</div>'
    )


def test_course_sync_includes_real_folder_courses_and_deduplicates(monkeypatch):
    root = (
        _course_card(11, 21, 31, "公共英语")
        + '<ul class="file-list"><li fileid="10"></li>'
        + '<li fileid="20"></li><li fileid="10"></li></ul>'
    )
    pages = {
        "10": _course_card(11, 21, 31, "公共英语")
              + _course_card(12, 22, 32, "工程制图"),
        "20": _course_card(13, 23, 33, "高等数学"),
    }

    class FolderSession:
        def __init__(self):
            self.visited = []
            self.closed = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.closed = True

        def post(self, url, *, data, timeout, allow_redirects):
            assert url == adapter.COURSES_URL
            assert timeout == (5, 12)
            assert allow_redirects is False
            assert data["query"] == ""
            folder = str(data["courseFolderId"])
            self.visited.append(folder)
            return Response(pages[folder])

    fake = FolderSession()
    client = adapter.XuexitongAdapter()
    monkeypatch.setattr(client, "_course_html", lambda: root)
    monkeypatch.setattr(adapter, "_session", lambda: fake)
    courses = client.list_courses()
    assert [item.title for item in courses] == ["公共英语", "工程制图", "高等数学"]
    assert [item.course_id for item in courses] == ["11:21:31", "12:22:32", "13:23:33"]
    assert all(item.progress_percent is None for item in courses)
    assert fake.visited == ["10", "20"]
    assert fake.closed


def test_folder_sync_error_must_not_claim_complete_course_listing(monkeypatch):
    root = _course_card(11, 21, 31, "公共英语") + '<ul class="file-list"><li fileid="10"></li></ul>'

    class FailingSession:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, *, data, timeout, allow_redirects):
            result = Response("拒绝访问")
            result.status_code = 403
            return result

    client = adapter.XuexitongAdapter()
    monkeypatch.setattr(client, "_course_html", lambda: root)
    monkeypatch.setattr(adapter, "_session", FailingSession)
    with pytest.raises(RuntimeError, match="XUEXITONG_RESPONSE_UNAVAILABLE"):
        client.list_courses()
