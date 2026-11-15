from studyflow.services import bridge
from studyflow.services.bridge import dispatch
from studyflow.core.models import Course, Platform
import pytest


def test_ping():
    assert dispatch({"id": "a", "version": 1, "operation": "ping"})["data"]["version"] == 1


def test_status_contract():
    result = dispatch({"id": "b", "version": 1, "operation": "platform.status"})
    assert result["ok"]
    assert [p["platform"] for p in result["data"]] == ["zhidao", "yuketang"]
    assert all(isinstance(p["connected"], bool) for p in result["data"])


def test_unknown_platform():
    result = dispatch({"id": "c", "version": 1, "operation": "courses.list", "platform": "unknown"})
    assert result["error"] == "UNKNOWN_PLATFORM"


def test_yuketang_progress_returns_only_current_run_snapshot(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    folder = tmp_path / "StudyFlow" / "legacy-logs" / "222-123456789000"
    folder.mkdir(parents=True)
    (folder / "刷课日志.log").write_text(
        "[2026-11-14 09:12] 服务器进度: 完成率=43.00%, 最后位置=80.0s\\n",
        encoding="utf-8",
    )
    request = {"id": "e", "version": 1, "operation": "yuketang.progress",
               "run_id": "222-123456789000"}
    result = dispatch(request)
    assert result["ok"] and result["data"]["server_percent"] == 43
    assert result["data"]["simulation_percent"] is None
    request["run_id"] = "222-123456789001"
    assert dispatch(request)["data"]["server_percent"] is None
    request["run_id"] = "../invalid"
    assert dispatch(request)["error"] == "INVALID_REQUEST"


def test_rejects_unrecognized_request():
    assert dispatch({"id": "d", "version": 1, "operation": "delete.all"})["error"] == "UNKNOWN_OPERATION"



def test_zhidao_progress_sync_returns_server_evidence(monkeypatch):
    course = Course(Platform.ZHIDAO, "a" * 64, "智慧课程", 40.0, "ai",
                    progress_evidence="server_verified", verified_at="2026-11-14T10:00:00Z")
    monkeypatch.setattr(bridge, "refresh_zhidao_progress", lambda: {
        "courses": [course], "incomplete": False, "fetched_at": "2026-11-14T10:00:00Z",
    })
    result = dispatch({"id": "z1", "version": 1, "operation": "zhidao.progress.sync"})
    assert result["ok"]
    assert result["data"]["courses"][0]["progress_percent"] == 40.0
    assert result["data"]["courses"][0]["progress_evidence"] == "server_verified"
    assert result["data"]["incomplete"] is False


def test_zhidao_single_course_verify_rejects_bad_key(monkeypatch):
    monkeypatch.setattr(bridge, "verify_zhidao_course",
                        lambda key: pytest.fail("invalid course key must not reach verifier"))
    result = dispatch({"id": "z2", "version": 1, "operation": "zhidao.progress.verify",
                       "course_key": "../invalid"})
    assert result == {"id": "z2", "ok": False, "error": "INVALID_REQUEST"}



def test_zhidao_player_target_and_settings_bridge(monkeypatch):
    monkeypatch.setattr(bridge, "resolve_zhidao_course", lambda key: {
        "course_key": key, "course_type": "ai", "course_id": "11",
        "class_id": "21", "recruit_and_course_id": "", "title": "智慧课程",
    })
    target = dispatch({"id":"p1","version":1,"operation":"zhidao.player.target","course_key":"a"*64})
    assert target["ok"] and target["data"]["course_id"] == "11"

    monkeypatch.setattr(bridge, "get_zhidao_player_settings", lambda: {"speed":"1.5"})
    settings = dispatch({"id":"p2","version":1,"operation":"zhidao.player.settings.get"})
    assert settings["ok"] and settings["data"]["speed"] == "1.5"


def test_zhidao_account_and_legal_operations_use_fixed_handlers(monkeypatch):
    monkeypatch.setattr(bridge.qr_runtime, "cancel", lambda: {"stage":"cancelled"})
    monkeypatch.setattr(bridge, "clear_zhidao_session", lambda: {"removed":2})
    assert dispatch({"id":"a1","version":1,"operation":"zhidao.session.clear"})["data"]["removed"] == 2
    monkeypatch.setattr(bridge, "clear_zhidao_course_cache", lambda: {"removed":2})
    assert dispatch({"id":"a2","version":1,"operation":"zhidao.cache.clear"})["data"]["removed"] == 2
    monkeypatch.setattr(bridge, "read_zhidao_document", lambda key: {"id":key,"content":"safe"})
    assert dispatch({"id":"a3","version":1,"operation":"zhidao.document.read","document_id":"privacy"})["data"]["content"] == "safe"



def test_zhidao_course_detail_bridge_returns_sanitized_details(monkeypatch):
    monkeypatch.setattr(bridge, "read_zhidao_course_detail", lambda key: {
        "course_key": key, "title": "课程", "course_type": "ai",
        "verified": True, "stale": False, "verified_at": "2026-11-14T10:00:00Z",
        "done": 1, "total": 2, "percent": 50.0,
        "items": [{"name":"知识点","progress_percent":100,"fully_progressed":True}],
    })
    result = dispatch({"id":"d1","version":1,"operation":"zhidao.course.detail","course_key":"a"*64})
    assert result["ok"] and result["data"]["items"][0]["progress_percent"] == 100



def test_studyflow_consent_bridge_reads_and_persists_acceptance(monkeypatch):
    monkeypatch.setattr(bridge, "get_consent_status", lambda: {"accepted": False})
    assert dispatch({"id":"c1","version":1,"operation":"studyflow.consent.status"})["data"]["accepted"] is False
    monkeypatch.setattr(bridge, "accept_studyflow_consent", lambda: {"accepted": True})
    assert dispatch({"id":"c2","version":1,"operation":"studyflow.consent.accept"})["data"]["accepted"] is True

def test_main_keeps_diagnostics_off_jsonl_stdout(monkeypatch, capsys):
    import io
    from types import SimpleNamespace

    request = {"id": "noisy-1", "version": 1, "operation": "ping"}
    monkeypatch.setattr(
        bridge.sys,
        "stdin",
        SimpleNamespace(buffer=io.BytesIO((__import__("json").dumps(request) + "\n").encode())),
    )

    def noisy_dispatch(value):
        print("diagnostic that must not enter JSONL")
        return {"id": value["id"], "ok": True, "data": {"version": 1}}

    monkeypatch.setattr(bridge, "dispatch", noisy_dispatch)
    protocol = io.StringIO()
    assert bridge.main(protocol) == 0

    rows = protocol.getvalue().splitlines()
    assert len(rows) == 1
    assert __import__("json").loads(rows[0]) == {
        "id": "noisy-1", "ok": True, "data": {"version": 1}
    }
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "diagnostic that must not enter JSONL" in captured.err



def test_yuketang_chapter_request_is_course_scoped_and_legacy_compatible(monkeypatch):
    seen = []
    def list_videos(course_id=None):
        seen.append(course_id)
        if course_id == "99":
            raise LookupError("wrong class")
        return [{"id":"12","name":"视频","chapter":"第一章"}]
    monkeypatch.setattr(bridge.ADAPTERS["yuketang"], "list_videos", list_videos)
    def call(**extra):
        return dispatch({"id":"yc1","version":1,"operation":"videos.list",
                         "platform":"yuketang",**extra})
    assert call(course_id="123")["data"][0]["chapter"] == "第一章"
    assert call()["ok"]
    assert seen == ["123", None]
    assert call(course_id="99")["error"] == "COURSE_NOT_FOUND"
    assert call(course_id="../invalid")["error"] == "INVALID_REQUEST"
    assert seen == ["123", None, "99"]
