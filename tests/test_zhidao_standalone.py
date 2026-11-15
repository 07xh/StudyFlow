"""Offline StudyFlow standalone Zhidao boundaries; no server or account required."""
from __future__ import annotations
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

from studyflow.platforms.zhidao import legacy_runtime, qr_runtime


ROOT = Path(__file__).resolve().parents[1]


def test_packaged_entry_exposes_only_readonly_progress_and_single_course_verify(monkeypatch):
    from types import ModuleType
    from studyflow.platforms.zhidao import upstream, verify_entry

    # Stub the vendored ZHS import boundary: this test validates dispatch only,
    # and CI intentionally does not install the user's external ZHS runtime.
    reader = ModuleType("zhidao_only")
    reader.main = lambda mode: 0 if mode == "progress" else 2
    reader.doctor_session = lambda: 0
    reader.doctor_server = lambda: 0
    monkeypatch.setattr(upstream, "zhidao_only", reader, raising=False)
    monkeypatch.setitem(sys.modules, "studyflow.platforms.zhidao.upstream.zhidao_only", reader)
    monkeypatch.setattr(verify_entry, "main", lambda args: 0 if args == ["a" * 64] else 2)

    spec = importlib.util.spec_from_file_location("studyflow_entry_test", ROOT / "packaging" / "bridge_entry.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    monkeypatch.setattr(sys, "argv", ["studyflow-bridge.exe", "--zhidao-readonly", "progress"])
    assert module.main() == 0
    monkeypatch.setattr(sys, "argv", ["studyflow-bridge.exe", "--zhidao-readonly", "session-check"])
    assert module.main() == 0
    monkeypatch.setattr(sys, "argv", ["studyflow-bridge.exe", "--zhidao-readonly", "doctor-server"])
    assert module.main() == 0
    monkeypatch.setattr(sys, "argv", ["studyflow-bridge.exe", "--zhidao-readonly", "verify-one"])
    assert module.main() == 2
    monkeypatch.setattr(sys, "argv", ["studyflow-bridge.exe", "--zhidao-verify-one", "a" * 64])
    assert module.main() == 0


def test_readonly_operations_use_this_app_python_not_legacy_venv(monkeypatch):
    seen = {}
    def fake_run(args, **kwargs):
        seen["args"] = args
        seen["cwd"] = kwargs["cwd"]
        return SimpleNamespace(returncode=0, stdout="[SESSION_OK]", stderr="")
    monkeypatch.setattr(legacy_runtime.subprocess, "run", fake_run)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    result = legacy_runtime._run_readonly("session-check", 5)
    assert result.returncode == 0
    assert seen["args"] == [sys.executable, "--zhidao-readonly", "session-check"]
    assert "ZHSDesktop" not in " ".join(seen["args"])


def test_frozen_qr_worker_uses_isolated_app_dir_and_pinned_token(monkeypatch, tmp_path):
    class Fake:
        def poll(self): return 0
    launches = []
    def fake_popen(args, **kwargs):
        launches.append((args, kwargs))
        return Fake()
    monkeypatch.setattr(qr_runtime, "installation_root", lambda: tmp_path)
    monkeypatch.setattr(qr_runtime, "python_executable", lambda: Path(sys.executable))
    monkeypatch.setattr(qr_runtime, "_WORKER", None)
    monkeypatch.setattr(qr_runtime.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    result = qr_runtime.start()
    assert result["stage"] == "requesting"
    args, kwargs = launches[0]
    assert args[:2] == [sys.executable, "--zhidao-qr-worker"]
    assert len(args[2]) == 32
    assert kwargs["env"]["STUDYFLOW_QR_STATUS_DIR"] == str(tmp_path)


def test_zhidao_cookie_store_is_not_part_of_program_install():
    assert Path.home() / ".zhs" != qr_runtime.installation_root()
    assert "ZHSDesktop" not in str(qr_runtime.installation_root())


def test_player_settings_migrate_readonly_without_writing_old_install(monkeypatch, tmp_path):
    import json
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    old = tmp_path / "ZHSDesktop" / "official-player-settings.json"
    old.parent.mkdir()
    original = json.dumps({"speed": "2", "autoNext": False})
    old.write_text(original, encoding="utf-8")
    settings = legacy_runtime.get_player_settings()
    assert settings["speed"] == "2"
    saved = legacy_runtime.save_player_settings({**settings, "speed": "1.25"})
    assert saved["speed"] == "1.25"
    assert old.read_text(encoding="utf-8") == original
    assert (tmp_path / "StudyFlow" / "zhidao" / "official-player-settings.json").is_file()


def test_zhidao_defaults_to_zhs_without_saved_preference(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert legacy_runtime.get_player_settings()["mode"] == "zhs-original"


def test_zhidao_respects_explicit_official_player_preference(monkeypatch, tmp_path):
    import json
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    saved = tmp_path / "StudyFlow" / "zhidao" / "official-player-settings.json"
    saved.parent.mkdir(parents=True)
    saved.write_text(json.dumps({"mode": "official"}), encoding="utf-8")
    assert legacy_runtime.get_player_settings()["mode"] == "official"
