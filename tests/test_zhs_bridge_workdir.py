"""Regression: every packaged ZHS worker must resolve ~/.zhs, not ./install/.zhs."""
from __future__ import annotations

import importlib.util
import io
import os
from pathlib import Path
import sys
import types

import pytest


ENTRY = Path(__file__).resolve().parents[1] / "packaging" / "bridge_entry.py"


def _entry_module():
    spec = importlib.util.spec_from_file_location("studyflow_bridge_entry_workdir_test", ENTRY)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("mode", ["jsonl", "qr"])
def test_packaged_worker_uses_home_for_zhs_session_files(tmp_path, monkeypatch, mode):
    home = tmp_path / "home"
    install = tmp_path / "install"
    (home / ".zhs").mkdir(parents=True)
    install.mkdir()
    (home / ".zhs" / "cookies.json").write_text("HOME_SESSION", encoding="utf-8")
    (install / ".zhs").mkdir()
    (install / ".zhs" / "cookies.json").write_text("STALE_SESSION", encoding="utf-8")

    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.chdir(install)
    entry = _entry_module()

    def verify_home():
        assert Path.cwd() == home
        assert Path(".zhs/cookies.json").read_text(encoding="utf-8") == "HOME_SESSION"
        return 0

    if mode == "jsonl":
        output = io.StringIO()
        monkeypatch.setattr(entry, "_prepare_jsonl_stdout", lambda: output)
        fake = types.ModuleType("studyflow.services.bridge")
        fake.main = lambda protocol_output: verify_home()
        monkeypatch.setitem(sys.modules, "studyflow.services.bridge", fake)
        monkeypatch.setattr(sys, "argv", ["studyflow-bridge.exe"])
    else:
        fake = types.ModuleType("studyflow.platforms.zhidao.qr_login_core")
        fake.main = lambda argv: verify_home()
        monkeypatch.setitem(sys.modules, "studyflow.platforms.zhidao.qr_login_core", fake)
        monkeypatch.setattr(sys, "argv", ["studyflow-bridge.exe", "--zhidao-qr-worker", "a" * 32])

    try:
        assert entry.main() == 0
    finally:
        # Restore the cwd before pytest removes tmp_path, even if an assertion fails.
        os.chdir(install)
