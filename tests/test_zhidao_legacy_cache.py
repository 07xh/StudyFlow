"""Offline integration tests against fake legacy install/cache. No real credentials."""
from __future__ import annotations

import hashlib
import hmac
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from studyflow.platforms.zhidao import legacy_runtime


@pytest.fixture
def session_cache(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    cache = home / ".zhs"
    cache.mkdir()
    salt = b"s" * 32
    cookies = b"FAKE_TEST_ONLY"
    (cache / "cookies.json").write_bytes(cookies)
    (cache / "zhidao-cache-salt.bin").write_bytes(salt)
    fingerprint = hmac.new(salt, cookies, hashlib.sha256).hexdigest()
    return cache, fingerprint


def test_real_cache_adapter_preserves_type_stale_and_identity(session_cache, monkeypatch):
    cache, fingerprint = session_cache
    rows = [
        {"courseType": "ai", "courseId": "11", "classId": "21", "name": "电工基础", "stale": False},
        {"courseType": "ai", "courseId": "11", "classId": "22", "name": "另一教学班", "stale": True},
        {"courseType": "shared", "courseId": "13", "recruitAndCourseId": "route1", "name": "公共课程"},
    ]
    (cache / "zhidao-courses.json").write_text(
        json.dumps({"source": "zhidao", "schemaVersion": 4,
                    "sessionFingerprint": fingerprint, "incomplete": False,
                    "courses": rows}), encoding="utf-8"
    )
    def fake_run(args, **kwargs):
        assert args == [sys.executable, "-m", "studyflow.platforms.zhidao.upstream.zhidao_only", "courses"]
        return SimpleNamespace(returncode=0, stdout="")
    monkeypatch.setattr(legacy_runtime.subprocess, "run", fake_run)
    result = legacy_runtime.read_courses()
    assert len(result) == 3
    assert len({row.course_id for row in result}) == 3
    assert result[0].course_type == "ai"
    assert result[1].stale is True
    assert all(row.progress_percent is None for row in result)
    assert all("route1" not in row.course_id for row in result)


def test_rotated_cookie_fails_closed(session_cache, monkeypatch):
    cache, fingerprint = session_cache
    (cache / "zhidao-courses.json").write_text(
        json.dumps({"source": "zhidao", "schemaVersion": 4,
                    "sessionFingerprint": fingerprint, "incomplete": False,
                    "courses": []}), encoding="utf-8"
    )
    (cache / "cookies.json").write_bytes(b"ROTATED_FAKE_COOKIE")
    monkeypatch.setattr(legacy_runtime.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(returncode=0, stdout=""))
    with pytest.raises(RuntimeError, match="session changed"):
        legacy_runtime.read_courses()



def test_same_session_progress_cache_is_exposed_as_server_verified(session_cache, monkeypatch):
    cache, fingerprint = session_cache
    rows = [
        {"courseType": "ai", "courseId": "11", "classId": "21", "name": "智慧课程"},
        {"courseType": "shared", "courseId": "13", "recruitAndCourseId": "route1", "name": "共享课程"},
    ]
    (cache / "zhidao-courses.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "courses": rows,
    }), encoding="utf-8")
    (cache / "zhidao-progress.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "fetchedAt": "2026-11-14T10:00:00+00:00", "incomplete": False,
        "courses": [
            {"courseType": "ai", "courseId": "11", "classId": "21", "name": "智慧课程",
             "knowledgePointCount": 10, "fullProgressPoints": 4, "lastVerifiedAt": "2026-11-14T10:00:00+00:00"},
            {"courseType": "shared", "courseId": "13", "recruitAndCourseId": "route1", "name": "共享课程",
             "videoCount": 8, "completedVideos": 6, "lastVerifiedAt": "2026-11-14T10:00:00+00:00"},
        ],
    }), encoding="utf-8")
    monkeypatch.setattr(legacy_runtime.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(returncode=0, stdout=""))
    result = legacy_runtime.read_courses()
    assert [x.progress_percent for x in result] == [40.0, 75.0]
    assert all(x.progress_evidence == "server_verified" for x in result)
    assert all(x.verified_at == "2026-11-14T10:00:00+00:00" for x in result)


def test_progress_cache_from_another_session_is_not_exposed(session_cache, monkeypatch):
    cache, fingerprint = session_cache
    rows = [{"courseType": "ai", "courseId": "11", "classId": "21", "name": "智慧课程"}]
    (cache / "zhidao-courses.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "courses": rows,
    }), encoding="utf-8")
    (cache / "zhidao-progress.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": "f" * 64,
        "courses": [{"courseType": "ai", "courseId": "11", "classId": "21",
                     "knowledgePointCount": 10, "fullProgressPoints": 10,
                     "lastVerifiedAt": "2026-11-14T10:00:00+00:00"}],
    }), encoding="utf-8")
    monkeypatch.setattr(legacy_runtime.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(returncode=0, stdout=""))
    result = legacy_runtime.read_courses()
    assert result[0].progress_percent is None
    assert result[0].progress_evidence is None


def test_verify_course_rejects_invalid_or_unmatched_keys_before_process(session_cache, monkeypatch):
    cache, fingerprint = session_cache
    monkeypatch.setattr(legacy_runtime.subprocess, "run",
                        lambda *a, **kw: pytest.fail("invalid key must not launch a process"))
    with pytest.raises(ValueError, match="INVALID_COURSE"):
        legacy_runtime.verify_course("../invalid")
    (cache / "zhidao-courses.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "courses": [],
    }), encoding="utf-8")
    with pytest.raises(RuntimeError, match="COURSE_NOT_FOUND"):
        legacy_runtime.verify_course("a" * 64)


def test_refresh_progress_uses_readonly_mode_and_accepts_partial_snapshot(session_cache, monkeypatch):
    cache, fingerprint = session_cache
    rows = [{"courseType": "ai", "courseId": "11", "classId": "21", "name": "智慧课程"}]
    (cache / "zhidao-courses.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "courses": rows,
    }), encoding="utf-8")
    (cache / "zhidao-progress.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "fetchedAt": "2026-11-14T10:00:00+00:00", "incomplete": True,
        "courses": [{"courseType": "ai", "courseId": "11", "classId": "21", "name": "智慧课程",
                     "knowledgePointCount": 10, "fullProgressPoints": 2,
                     "lastVerifiedAt": "2026-11-14T10:00:00+00:00"}],
    }), encoding="utf-8")
    calls = []
    monkeypatch.setattr(legacy_runtime, "_run_readonly",
                        lambda command, timeout: (calls.append((command, timeout)) or SimpleNamespace(returncode=1)))
    snapshot = legacy_runtime.refresh_progress()
    assert calls == [("progress", 300)]
    assert snapshot["incomplete"] is True
    assert snapshot["courses"][0].progress_percent == 20.0



def test_resolve_course_returns_only_current_session_official_route(session_cache):
    directory, fingerprint = session_cache
    rows = [
        {"courseType": "ai", "courseId": "11", "classId": "21", "name": "智慧课程"},
        {"courseType": "shared", "courseId": "13", "classId": "0",
         "recruitAndCourseId": "route_13", "name": "共享课程"},
    ]
    (directory / "zhidao-courses.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "courses": rows,
    }), encoding="utf-8")
    ai_key = legacy_runtime.progress_key(rows[0])
    shared_key = legacy_runtime.progress_key(rows[1])
    ai = legacy_runtime.resolve_course(ai_key)
    shared = legacy_runtime.resolve_course(shared_key)
    assert (ai["course_type"], ai["course_id"], ai["class_id"]) == ("ai", "11", "21")
    assert shared["course_type"] == "shared"
    assert shared["recruit_and_course_id"] == "route_13"


def test_player_settings_roundtrip_and_reject_invalid_values(session_cache):
    defaults = legacy_runtime.get_player_settings()
    assert defaults["speed"] == "1.5" and defaults["mode"] == "official"
    saved = legacy_runtime.save_player_settings({
        "speed": "2", "allowMinimize": False, "autoStart": False,
        "autoNext": True, "mode": "official",
    })
    assert saved["speed"] == "2" and saved["allowMinimize"] is False
    assert legacy_runtime.get_player_settings() == saved
    with pytest.raises(ValueError, match="INVALID_PLAYER_SETTINGS"):
        legacy_runtime.save_player_settings({"speed": "8", "allowMinimize": True,
                                             "autoStart": True, "autoNext": True})


def test_signout_and_cache_clear_use_separate_exact_allowlists(session_cache):
    directory, _ = session_cache
    (directory / "qrcode.png").write_bytes(b"qr")
    (directory / "zhidao-courses.json").write_text("{}", encoding="utf-8")
    (directory / "zhidao-progress.json").write_text("{}", encoding="utf-8")
    (directory / "keep-me.bin").write_bytes(b"keep")
    assert legacy_runtime.clear_session()["removed"] == 2
    assert not (directory / "cookies.json").exists()
    assert (directory / "zhidao-courses.json").exists()
    assert legacy_runtime.clear_course_cache()["removed"] == 2
    assert (directory / "zhidao-cache-salt.bin").exists()
    assert (directory / "keep-me.bin").read_bytes() == b"keep"


def test_diagnostics_returns_only_allowlisted_summary_lines(monkeypatch):
    monkeypatch.setattr(legacy_runtime, "_run_readonly", lambda *a: SimpleNamespace(
        returncode=7, stdout="[SESSION_OK] confirmed\n[SERVER_PARTIAL] partial\nSECRET raw cookie\n"))
    result = legacy_runtime.diagnose_server()
    assert result["state"] == "partial"
    assert result["lines"] == ["[SESSION_OK] confirmed", "[SERVER_PARTIAL] partial"]


def test_legal_document_reader_is_allowlisted():
    document = legacy_runtime.read_document("terms")
    assert document["id"] == "terms"
    assert "第三方" in document["title"]
    privacy = legacy_runtime.read_document("privacy")
    assert "StudyFlow" in privacy["content"]
    assert "zhidao-player" in privacy["content"]
    assert "ZHS 0.1.5 原版任务" in privacy["content"]
    with pytest.raises(ValueError, match="INVALID_DOCUMENT"):
        legacy_runtime.read_document("../cookies.json")



def test_course_detail_restores_ai_knowledge_points_and_shared_videos(session_cache):
    directory, fingerprint = session_cache
    ai = {"courseType": "ai", "courseId": "11", "classId": "21", "name": "智慧课程"}
    shared = {"courseType": "shared", "courseId": "13",
              "recruitAndCourseId": "route_13", "name": "共享课程"}
    (directory / "zhidao-courses.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "courses": [ai, shared],
    }), encoding="utf-8")
    (directory / "zhidao-progress.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "courses": [
            {**ai, "knowledgePointCount": 2, "fullProgressPoints": 1,
             "knowledgePoints": [
                 {"name": "基础概念", "theme": "第一章", "progressPercent": 100},
                 {"name": "应用分析", "theme": "第二章", "progressPercent": 40},
             ], "lastVerifiedAt": "2026-11-14T10:00:00+00:00"},
            {**shared, "videoCount": 2, "completedVideos": 1,
             "videos": [
                 {"name": "第一讲", "durationSeconds": 600, "studiedSeconds": 600, "serverCompleted": True},
                 {"name": "第二讲", "durationSeconds": 900, "studiedSeconds": 120, "serverCompleted": False},
             ], "lastVerifiedAt": "2026-11-14T10:00:00+00:00"},
        ],
    }), encoding="utf-8")
    ai_detail = legacy_runtime.read_course_detail(legacy_runtime.progress_key(ai))
    shared_detail = legacy_runtime.read_course_detail(legacy_runtime.progress_key(shared))
    assert ai_detail["done"] == 1 and ai_detail["total"] == 2
    assert ai_detail["items"][0]["fully_progressed"] is True
    assert shared_detail["done"] == 1 and shared_detail["total"] == 2
    assert shared_detail["items"][1]["studied_seconds"] == 120
    assert shared_detail["items"][1]["server_completed"] is False



def test_first_run_consent_is_persisted_in_studyflow_app_data(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert legacy_runtime.consent_status() == {"accepted": False}
    assert legacy_runtime.accept_consent() == {"accepted": True}
    assert legacy_runtime.consent_status() == {"accepted": True}
    assert (tmp_path / "StudyFlow" / "privacy-accepted-v1.flag").is_file()


@pytest.mark.parametrize("change", ["unchanged", "unrelated", "stale", "fresh"])
def test_single_course_verification_requires_new_target_server_evidence(session_cache, monkeypatch, change):
    """Exit 0 is insufficient unless the selected course gained fresh evidence."""
    directory, fingerprint = session_cache
    target = {"courseType": "ai", "courseId": "11", "classId": "21", "name": "目标"}
    unrelated = {"courseType": "ai", "courseId": "12", "classId": "22", "name": "其他课程"}
    (directory / "zhidao-courses.json").write_text(json.dumps({
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "courses": [target, unrelated],
    }), encoding="utf-8")
    old = "2026-11-14T10:00:00+00:00"
    new = "2026-11-15T10:00:00+00:00"
    path = directory / "zhidao-progress.json"
    data = {
        "source": "zhidao", "schemaVersion": 4, "sessionFingerprint": fingerprint,
        "incomplete": False, "fetchedAt": old,
        "courses": [
            {**target, "knowledgePointCount": 4, "fullProgressPoints": 2, "lastVerifiedAt": old},
            {**unrelated, "knowledgePointCount": 4, "fullProgressPoints": 1, "lastVerifiedAt": old},
        ],
    }
    path.write_text(json.dumps(data), encoding="utf-8")
    key = legacy_runtime.progress_key(target)

    def fake_run(*args, **kwargs):
        assert "--zhidao-verify-one" in args[0] or "studyflow.platforms.zhidao.verify_entry" in args[0]
        assert args[0][-1] == key
        if change in ("unrelated", "stale", "fresh"):
            record = data["courses"][1 if change == "unrelated" else 0]
            record["lastVerifiedAt"] = new
            if change == "stale":
                record["stale"] = True
            path.write_text(json.dumps(data), encoding="utf-8")
        return SimpleNamespace(returncode=0, stdout="")

    monkeypatch.setattr(legacy_runtime.subprocess, "run", fake_run)
    if change == "fresh":
        snapshot = legacy_runtime.verify_course(key)
        assert not snapshot["incomplete"]
        chosen = next(row for row in snapshot["courses"] if row.course_id == key)
        assert chosen.progress_evidence == "server_verified"
        assert chosen.verified_at == new and chosen.progress_percent == 50.0
    else:
        with pytest.raises(RuntimeError, match="no fresh evidence"):
            legacy_runtime.verify_course(key)
