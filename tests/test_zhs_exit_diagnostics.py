"""Local ZHS task-exit diagnostics: bounded nonsecret classifications only."""
from __future__ import annotations

import json
import sys
from types import ModuleType

from studyflow.services import legacy_playback as legacy


def _fake_cli(monkeypatch, result):
    from importlib import metadata

    package = ModuleType("zhs")
    cli = ModuleType("zhs.__main__")

    def app(*, args, standalone_mode):
        assert standalone_mode is False
        if isinstance(result, BaseException):
            raise result
        return result

    cli.app = app
    monkeypatch.setitem(sys.modules, "zhs", package)
    monkeypatch.setitem(sys.modules, "zhs.__main__", cli)
    monkeypatch.setattr(metadata, "version", lambda name: "0.1.5" if name == "zhs" else "0")


def test_zhs_exit_1_has_safe_network_diagnostic_without_exception_text(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    _fake_cli(monkeypatch, TimeoutError("Cookie SECRET=do-not-log"))
    token = "c" * 32
    code = legacy._run_bundled_zhs_args(["play", "-c", "20:30", "--type", "ai"], token)
    assert code == 1
    data = json.loads((tmp_path / "StudyFlow" / f"zhs-diagnostic-{token}.json").read_text())
    assert data["v"] == 1
    assert data["code"] == "NETWORK_ERROR"
    assert data["token"] == token
    assert set(data) == {"v", "code", "token", "at"}
    assert "SECRET" not in json.dumps(data)


def test_nonzero_upstream_exit_is_not_misclassified_as_success(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    _fake_cli(monkeypatch, 1)
    token = "d" * 32
    assert legacy._run_bundled_zhs_args(["play", "-c", "20:30", "--type", "ai"], token) == 1
    data = json.loads((tmp_path / "StudyFlow" / f"zhs-diagnostic-{token}.json").read_text())
    assert data["code"] == "UPSTREAM_NONZERO_EXIT"


def test_worker_entry_failure_is_bounded_and_does_not_leak_course_data(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    def explode(key):
        raise KeyError("authorization header: SECRET")
    monkeypatch.setattr(legacy, "_current_course_row", explode)
    token = "e" * 32
    assert legacy.main(["--legacy-zhidao", "a" * 64, token]) == 1
    data = json.loads((tmp_path / "StudyFlow" / f"zhs-diagnostic-{token}.json").read_text())
    assert data["code"] == "WORKER_ENTRY_EXCEPTION"
    assert "SECRET" not in json.dumps(data)


def test_invalid_monitor_token_never_creates_a_file(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    legacy._write_zhs_diagnostic("../escape", "NETWORK_ERROR")
    legacy._write_zhs_diagnostic("f" * 32, "COOKIE=SECRET")
    assert not (tmp_path / "StudyFlow").exists()


def test_zhs_session_preflight_failure_gets_distinct_exit_stage(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    _fake_cli(monkeypatch, None)
    upstream = sys.modules["zhs.__main__"]
    def load_config(*args, **kwargs):
        return None
    def cli(*, args, standalone_mode):
        assert upstream._load_config_and_session(False, False, None) is None
        raise SystemExit(1)
    upstream.app = cli
    upstream._load_config_and_session = load_config
    token = "1" * 32
    assert legacy._run_bundled_zhs_args(["play", "-c", "20:30", "--type", "ai"], token) == 1
    data = json.loads((tmp_path / "StudyFlow" / f"zhs-diagnostic-{token}.json").read_text())
    assert data["code"] == "ZHS_SESSION_PREFLIGHT_FAILED"
    assert upstream._load_config_and_session is load_config


def test_zhs_course_url_failure_gets_distinct_exit_stage_without_raw_error(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    _fake_cli(monkeypatch, None)
    upstream = sys.modules["zhs.__main__"]
    def dispatcher(*args, **kwargs):
        raise ValueError("Cookie SECRET=never-persist-this")
    def cli(*, args, standalone_mode):
        try:
            upstream._dispatch_play_url(None, None, "opaque URL")
        except ValueError:
            raise SystemExit(1)
    upstream.app = cli
    upstream._dispatch_play_url = dispatcher
    token = "2" * 32
    assert legacy._run_bundled_zhs_args(["play", "--url", "opaque URL"], token) == 1
    data = json.loads((tmp_path / "StudyFlow" / f"zhs-diagnostic-{token}.json").read_text())
    assert data["code"] == "ZHS_COURSE_URL_FAILED"
    assert "SECRET" not in json.dumps(data)
    assert upstream._dispatch_play_url is dispatcher
