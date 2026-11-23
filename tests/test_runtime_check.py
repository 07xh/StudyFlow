"""Check original-script imports without credentials, network or task execution."""
import sys
from pathlib import Path


def test_yuketang_import_probe_preserves_process_and_never_sends_requests(monkeypatch, tmp_path):
    import requests
    from studyflow.services.runtime_check import check_yuketang
    before = (sys.stdout, sys.stderr, Path.cwd())
    monkeypatch.setenv("YKT_HOME", str(tmp_path / "existing"))
    monkeypatch.setattr(requests.sessions.Session, "request", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    assert check_yuketang() == 0
    assert (sys.stdout, sys.stderr, Path.cwd()) == before
    assert not (tmp_path / "existing").exists()


def test_yuketang_probe_reports_missing_bundled_resource(monkeypatch, tmp_path):
    from studyflow.services import legacy_playback, runtime_check
    monkeypatch.setattr(legacy_playback, "_legacy_source", lambda: tmp_path / "missing.py")
    assert runtime_check.check_yuketang() == 5


def test_ucampus_socket_packaging_check_never_loads_credentials_or_connects(monkeypatch):
    import websocket
    from studyflow.services import runtime_check
    from studyflow.platforms.ucampus import credentials

    def forbidden(*_args, **_kwargs):
        raise AssertionError("No network connection or credential lookup is permitted")

    monkeypatch.setattr(websocket, "create_connection", forbidden)
    monkeypatch.setattr(credentials, "load", forbidden)
    assert runtime_check.check_ucampus_socket() == 0


def test_ucampus_socket_packaging_check_fails_closed_on_missing_dependency(monkeypatch):
    import websocket
    from studyflow.services import runtime_check
    monkeypatch.delattr(websocket, "create_connection", raising=False)
    assert runtime_check.check_ucampus_socket() == 5
