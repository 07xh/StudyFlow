"""Offline checks for direct reuse of the recovered YKT exe_entry.py.

These tests never import or execute main.py and never contact any platform.
"""
from pathlib import Path

import pytest

from studyflow.platforms.yuketang import legacy_config as config
from studyflow.services import bridge


def test_original_launcher_is_configuration_source(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDYFLOW_YKT_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("YKT_HOME", str(tmp_path / "run-logs"))
    monkeypatch.delenv("VIDEO_SPEED", raising=False)
    original = config._launcher()
    assert Path(original.__file__).name == "exe_entry.py"
    assert config.read_settings()["completion_threshold"] == 90

    (tmp_path / ".env").write_text(
        "# keep personal comment\nOTHER_SETTING=preserve\nVIDEO_SPEED=1.0\n",
        encoding="utf-8",
    )
    settings = config.read_settings()
    assert settings["video_speed"] == 1.0
    settings["max_concurrent_videos"] == 3

    edited = {**settings, "video_speed": 1.5, "completion_threshold": 95}
    assert config.save_settings(edited) == edited
    persisted = (tmp_path / ".env").read_text(encoding="utf-8")
    assert "# keep personal comment" in persisted
    assert "OTHER_SETTING=preserve" in persisted
    assert "VIDEO_SPEED=1.5" in persisted
    assert "COMPLETION_THRESHOLD=95" in persisted


@pytest.mark.parametrize("bad_value", [float("nan"), float("inf"), -1, 101])
def test_invalid_threshold_never_overwrites_original_env(monkeypatch, tmp_path, bad_value):
    monkeypatch.setenv("STUDYFLOW_YKT_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("YKT_HOME", str(tmp_path / "run-logs"))
    original = config.read_settings()
    with pytest.raises(ValueError):
        config.save_settings({**original, "completion_threshold": bad_value})
    assert not (tmp_path / ".env").exists()


def test_original_environment_settings_do_not_override_explicit_choice(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDYFLOW_YKT_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("YKT_HOME", str(tmp_path / "run-logs"))
    monkeypatch.setenv("VIDEO_SPEED", "2.5")
    (tmp_path / ".env").write_text("VIDEO_SPEED=1.0\n", encoding="utf-8")
    assert config.prepare_environment() == tmp_path
    assert config.read_settings()["video_speed"] == 1.0
    assert config.os.environ["VIDEO_SPEED"] == "2.5"


def test_bridge_exposes_only_known_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDYFLOW_YKT_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("YKT_HOME", str(tmp_path / "run-logs"))
    (tmp_path / ".env").write_text("OTHER_SECRET=sensitive\n", encoding="utf-8")
    read = bridge.dispatch({"id": "get", "version": 1, "operation": "yuketang.settings.get"})
    assert read["ok"] and "OTHER_SECRET" not in str(read)
    options = {**read["data"], "max_concurrent_videos": 2}
    saved = bridge.dispatch({
        "id": "save", "version": 1, "operation": "yuketang.settings.save",
        "settings": options,
    })
    assert saved["ok"] and saved["data"]["max_concurrent_videos"] == 2
    assert "OTHER_SECRET=sensitive" in (tmp_path / ".env").read_text(encoding="utf-8")
    invalid = bridge.dispatch({
        "id": "bad", "version": 1, "operation": "yuketang.settings.save",
        "settings": {**options, "max_concurrent_videos": 99},
    })
    assert invalid == {"id": "bad", "ok": False, "error": "INVALID_YUKETANG_SETTINGS"}


def test_original_exe_entry_is_frozen_in_desktop_package():
    root = Path(__file__).resolve().parents[1]
    script = (root / "scripts" / "build-sidecar.ps1").read_text(encoding="utf-8")
    assert "legacy/yuketang/exe_entry.py" in script


def test_task_log_home_never_shadows_persistent_settings(monkeypatch, tmp_path):
    config_dir = tmp_path / "persistent-settings"
    run_dir = tmp_path / "legacy-logs" / "222-123456789000"
    config_dir.mkdir()
    monkeypatch.setenv("STUDYFLOW_YKT_CONFIG_HOME", str(config_dir))
    monkeypatch.setenv("YKT_HOME", str(run_dir))
    monkeypatch.delenv("VIDEO_SPEED", raising=False)
    (config_dir / ".env").write_text(
        "VIDEO_SPEED=2.25\nHEARTBEAT_INTERVAL=7\n",
        encoding="utf-8",
    )

    assert config.config_home() == config_dir
    assert config.read_settings()["video_speed"] == 2.25
    assert config.prepare_environment() == config_dir
    assert config.os.environ["YKT_HOME"] == str(run_dir)
    assert config.os.environ["VIDEO_SPEED"] == "2.25"
    assert config.os.environ["HEARTBEAT_INTERVAL"] == "7"

    settings = config.read_settings()
    saved = config.save_settings({**settings, "video_speed": 1.75})
    assert saved["video_speed"] == 1.75
    assert config.os.environ["YKT_HOME"] == str(run_dir)
    assert "VIDEO_SPEED=1.75" in (config_dir / ".env").read_text(encoding="utf-8")
    assert not (run_dir / ".env").exists()
