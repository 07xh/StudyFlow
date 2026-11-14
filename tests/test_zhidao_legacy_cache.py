"""Offline integration tests against fake legacy install/cache. No real credentials."""
from __future__ import annotations

import hashlib
import hmac
import json
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
        assert args == [str(python), str(install / "zhidao_only.py"), "courses"]
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
