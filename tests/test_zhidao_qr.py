"""Regression tests for migrated Zhidao QR core and StudyFlow bridge.

No real Zhidao account or network access is used.
"""
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from studyflow.platforms.zhidao import legacy_runtime, qr_runtime
from studyflow.platforms.zhidao.qr_login_core import LoginObservation, STAGES
from studyflow.services.bridge import dispatch


def test_qr_core_stages_and_sanitized_observation(tmp_path):
    token = "a" * 32
    observation = LoginObservation(token, root=tmp_path)
    observation.record("requesting")
    state = json.loads((tmp_path / f"monitor-qr-{token}.json").read_text())
    assert state["stage"] == "requesting"
    assert set(state) == {"v", "token", "stage", "at"}
    assert {"environment-error", "verified", "scanned"} <= STAGES


def test_qr_bridge_calls_and_no_raw_exception(monkeypatch):
    monkeypatch.setattr(qr_runtime, "start", lambda: {"stage": "requesting"})
    monkeypatch.setattr(qr_runtime, "status", lambda: {"stage": "ready", "image_png_base64": None})
    monkeypatch.setattr(qr_runtime, "cancel", lambda: {"stage": "cancelled"})
    for action, stage in (("start", "requesting"), ("status", "ready"), ("cancel", "cancelled")):
        result = dispatch({"id": "a", "version": 1, "operation": "zhidao.qr." + action})
        assert result["ok"] and result["data"]["stage"] == stage
    def raise_secret():
        raise RuntimeError("SENSITIVE_COOKIE_MUST_NOT_LEAK")
    monkeypatch.setattr(qr_runtime, "start", raise_secret)
    result = dispatch({"id": "b", "version": 1, "operation": "zhidao.qr.start"})
    assert result["error"] == "ZHIDAO_QR_UNAVAILABLE"
    assert "SENSITIVE_COOKIE" not in str(result)


def test_qr_start_requires_installed_runtime(monkeypatch, tmp_path):
    monkeypatch.setattr(qr_runtime, "python_executable", lambda: tmp_path / "missing.exe")
    monkeypatch.setattr(qr_runtime, "_WORKER", None)
    assert qr_runtime.start()["stage"] == "environment-error"


def test_qr_status_reads_only_current_png(monkeypatch, tmp_path):
    monkeypatch.setattr(qr_runtime, "installation_root", lambda: tmp_path)
    monkeypatch.setattr(qr_runtime, "_qr_path", lambda token: tmp_path / f"studyflow-qr-{token}.png")
    token = "b" * 32
    started = __import__("time").time()
    LoginObservation(token, root=tmp_path).record("ready")
    png = tmp_path / f"studyflow-qr-{token}.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 150)
    monkeypatch.setattr(qr_runtime, "_TOKEN", token)
    monkeypatch.setattr(qr_runtime, "_STARTED", started)
    monkeypatch.setattr(qr_runtime, "_WORKER", SimpleNamespace(poll=lambda: None))
    monkeypatch.setattr(qr_runtime, "_FINAL_STAGE", None)
    state = qr_runtime.status()
    assert state["stage"] == "ready" and state["image_png_base64"]
    os.utime(png, (started - 3600, started - 3600))
    assert qr_runtime.status()["image_png_base64"] is None
    assert not (tmp_path / "cookies.json").exists()


def test_qr_cancel_does_not_delete_cookies(monkeypatch, tmp_path):
    monkeypatch.setattr(qr_runtime, "_qr_path", lambda token: tmp_path / f"studyflow-qr-{token}.png")
    monkeypatch.setattr(qr_runtime, "installation_root", lambda: tmp_path)
    monkeypatch.setattr(qr_runtime, "_TOKEN", "c" * 32)
    monkeypatch.setattr(qr_runtime, "_WORKER", None)
    (tmp_path / ("studyflow-qr-" + "c"*32 + ".png")).write_bytes(b"test")
    (tmp_path / "qrcode.png").write_bytes(b"ORIGINAL_WPF_QR")
    (tmp_path / "cookies.json").write_text("PRESERVE")
    assert qr_runtime.cancel()["stage"] == "cancelled"
    assert not (tmp_path / ("studyflow-qr-" + "c"*32 + ".png")).exists()
    assert (tmp_path / "qrcode.png").read_bytes() == b"ORIGINAL_WPF_QR"
    assert (tmp_path / "cookies.json").read_text() == "PRESERVE"


def test_probe_login_uses_session_proof_when_course_apis_fail(monkeypatch):
    # doctor-server returns 6 when both course sources fail, even though the
    # preceding [SESSION_OK] marker proves the account session is valid.
    result = SimpleNamespace(
        returncode=6,
        stdout="[SESSION_OK] 服务端登录校验通过\\n[SERVER_UNCONFIRMED] 两类只读接口均失败",
    )
    monkeypatch.setattr(legacy_runtime, "_run_readonly", lambda *_: result)
    assert legacy_runtime.probe_login() is True


def test_probe_login_requires_explicit_server_session_proof(monkeypatch):
    result = SimpleNamespace(returncode=0, stdout="[SERVER_OK] 课程接口可读，但没有登录证明")
    monkeypatch.setattr(legacy_runtime, "_run_readonly", lambda *_: result)
    assert legacy_runtime.probe_login() is False
