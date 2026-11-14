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
def installed_reader(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    installation = tmp_path / "appdata" / "ZHSDesktop"
    installation.mkdir(parents=True)
    (installation / "zhidao_only.py").write_text("# fake reader\n", encoding="utf-8")
    python = installation / ".venv" / "Scripts" / "python.exe"
    python.parent.mkdir(parents=True)
    python.write_text("fake", encoding="utf-8")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    cache = home / ".zhs"
    cache.mkdir()
    salt = b"s" * 32
    cookies = b"FAKE_TEST_ONLY"
    (cache / "cookies.json").write_bytes(cookies)
    (cache / "zhidao-cache-salt.bin").write_bytes(salt)
    fingerprint = hmac.new(salt, cookies, hashlib.sha256).hexdigest()
    return installation, python, cache, fingerprint


def test_flat_legacy_install_location(installed_reader):
    install, _, _, _ = installed_reader
    assert legacy_runtime.legacy_script() == install / "zhidao_only.py"


def test_real_cache_adapter_preserves_type_stale_and_identity(installed_reader, monkeypatch):
    install, python, cache, fingerprint = installed_reader
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


def test_rotated_cookie_fails_closed(installed_reader, monkeypatch):
    install, _, cache, fingerprint = installed_reader
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



def test_same_session_progress_cache_is_exposed_as_server_verified(installed_reader, monkeypatch):
    _, _, cache, fingerprint = installed_reader
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


def test_progress_cache_from_another_session_is_not_exposed(installed_reader, monkeypatch):
    _, _, cache, fingerprint = installed_reader
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


def test_verify_course_rejects_invalid_or_unmatched_keys_before_process(installed_reader, monkeypatch):
    _, _, cache, fingerprint = installed_reader
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


def test_refresh_progress_uses_readonly_mode_and_accepts_partial_snapshot(installed_reader, monkeypatch):
    _, _, cache, fingerprint = installed_reader
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
