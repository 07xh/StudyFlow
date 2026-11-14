"""Offline checks for direct reuse of the recovered YKT exe_entry.py.

These tests never import or execute main.py and never contact any platform.
"""
from pathlib import Path

import pytest

from studyflow.platforms.yuketang import legacy_config as config
from studyflow.services import bridge


def test_original_launcher_is_configuration_source(monkeypatch, tmp_path):
    monkeypatch.setenv("YKT_HOME", str(tmp_path))
    monkeypatch.delenv("VIDEO_SPEED", raising=False)
    original = config._launcher()
    assert Path(original.__file__).name == "exe_entry.py"
    defaults = config.read_settings()
    assert defaults["completion_threshold"] == 90
    assert defaults["debug"] is False
    assert defaults["richtext_stay_seconds"] == 3
    assert defaults["richtext_skip_delay"] == 1.0

    (tmp_path / ".env").write_text(
        "# keep personal comment\nOTHER_SETTING=preserve\nVIDEO_SPEED=1.0\n"
        "DEBUG=true\nRICHTEXT_STAY_SECONDS=7\nRICHTEXT_SKIP_DELAY=1.5\n",
        encoding="utf-8",
    )
    settings = config.read_settings()
    assert settings["video_speed"] == 1.0
    assert settings["debug"] is True
    assert settings["richtext_stay_seconds"] == 7
    assert settings["richtext_skip_delay"] == 1.5
    assert settings["max_concurrent_videos"] == 3

    edited = {
        **settings, "video_speed": 1.5, "completion_threshold": 95,
        "debug": False, "richtext_stay_seconds": 9, "richtext_skip_delay": 2.5,
    }
    assert config.save_settings(edited) == edited
    persisted = (tmp_path / ".env").read_text(encoding="utf-8")
    assert "# keep personal comment" in persisted
    assert "OTHER_SETTING=preserve" in persisted
    assert "VIDEO_SPEED=1.5" in persisted
    assert "COMPLETION_THRESHOLD=95" in persisted
    assert "DEBUG=false" in persisted
    assert "RICHTEXT_STAY_SECONDS=9" in persisted
    assert "RICHTEXT_SKIP_DELAY=2.5" in persisted


@pytest.mark.parametrize("bad_value", [float("nan"), float("inf"), -1, 101])
def test_invalid_threshold_never_overwrites_original_env(monkeypatch, tmp_path, bad_value):
    monkeypatch.setenv("YKT_HOME", str(tmp_path))
    original = config.read_settings()
    with pytest.raises(ValueError):
        config.save_settings({**original, "completion_threshold": bad_value})
    assert not (tmp_path / ".env").exists()


@pytest.mark.parametrize(
    "field,bad_value",
    [
        ("richtext_stay_seconds", -1),
        ("richtext_stay_seconds", 3601),
        ("richtext_skip_delay", float("nan")),
        ("richtext_skip_delay", -0.1),
        ("richtext_skip_delay", 3601),
        ("debug", "true"),
    ],
)
def test_invalid_restored_original_options_never_overwrite_env(monkeypatch, tmp_path, field, bad_value):
    monkeypatch.setenv("YKT_HOME", str(tmp_path))
    original = config.read_settings()
    with pytest.raises(ValueError):
        config.save_settings({**original, field: bad_value})
    assert not (tmp_path / ".env").exists()


def test_original_environment_settings_do_not_override_explicit_choice(monkeypatch, tmp_path):
    monkeypatch.setenv("YKT_HOME", str(tmp_path))
    monkeypatch.setenv("VIDEO_SPEED", "2.5")
    (tmp_path / ".env").write_text("VIDEO_SPEED=1.0\n", encoding="utf-8")
    assert config.prepare_environment() == tmp_path
    assert config.read_settings()["video_speed"] == 1.0
    assert config.os.environ["VIDEO_SPEED"] == "2.5"


def test_run_environment_loads_persistent_settings_without_replacing_run_log_dir(monkeypatch, tmp_path):
    settings_home = tmp_path / "persistent-settings"
    run_home = tmp_path / "run-123"
    settings_home.mkdir()
    (settings_home / ".env").write_text(
        "VIDEO_SPEED=1.8\nDEBUG=true\nRICHTEXT_STAY_SECONDS=11\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("YKT_HOME", str(run_home))
    for key in ("VIDEO_SPEED", "DEBUG", "RICHTEXT_STAY_SECONDS"):
        monkeypatch.delenv(key, raising=False)

    loaded = config.prepare_environment(settings_home)

    assert loaded == settings_home
    assert config.os.environ["YKT_HOME"] == str(run_home)
    assert config.os.environ["VIDEO_SPEED"] == "1.8"
    assert config.os.environ["DEBUG"] == "true"
    assert config.os.environ["RICHTEXT_STAY_SECONDS"] == "11"


def test_bridge_exposes_only_known_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("YKT_HOME", str(tmp_path))
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


def test_every_original_yuketang_runtime_setting_is_exposed_in_studyflow():
    root = Path(__file__).resolve().parents[1]
    original_main = (root / "legacy" / "yuketang" / "main.py").read_text(encoding="utf-8")
    runtime_keys = {
        line.split("os.getenv(", 1)[1].split(")", 1)[0].split(",", 1)[0].strip().strip("'\\\"")
        for line in original_main.splitlines()
        if "os.getenv(" in line
    }
    credential_keys = {
        "CLASSROOM_ID", "SIGN", "UNIVERSITY_ID", "CSRF_TOKEN", "SESSION_ID",
    }

    # Every non-credential setting read by the unchanged upstream main.py
    # must have one typed config mapping and a visible platform-specific UI.
    assert runtime_keys - credential_keys == set(config.FIELDS.values())
    assert set(config.DEFAULTS) == set(config.FIELDS.values())

    ui = (root / "frontend" / "src" / "components" / "YuketangTaskArea.tsx").read_text(encoding="utf-8")
    types = (root / "frontend" / "src" / "legacyPlayback.ts").read_text(encoding="utf-8")
    for field, env_key in config.FIELDS.items():
        assert field in ui
        assert field in types

    # The native task supervisor must expose the same typed fields and pass
    # every non-credential setting to the unchanged original child process.
    rust = (root / "src-tauri" / "src" / "legacy_tasks.rs").read_text(encoding="utf-8")
    for field, env_key in config.FIELDS.items():
        assert field in rust
        assert f'command.env("{env_key}"' in rust



def test_windows_package_checks_both_platforms_inside_frozen_runtime():
    root = Path(__file__).resolve().parents[1]
    entry = (root / "packaging" / "bridge_entry.py").read_text(encoding="utf-8")
    sidecar = (root / "scripts" / "build-sidecar.ps1").read_text(encoding="utf-8")
    installer_test = (root / "scripts" / "test-windows-install.ps1").read_text(encoding="utf-8")
    workflow = (root / ".github" / "workflows" / "build-windows.yml").read_text(encoding="utf-8")

    assert "--packaged-runtime-self-test" in entry
    assert "sys.frozen" in entry and "sys._MEIPASS" in entry
    assert "legacy/yuketang/main.py" in entry
    assert "legacy/yuketang/exe_entry.py" in entry
    assert "legacy/zhidao/ZHS-ConsoleMonitor.py" in entry
    assert "legacy/zhidao/Zhidao-Task.cmd" in entry
    assert "--packaged-runtime-self-test" in sidecar
    assert "yuketang.settings.get" in sidecar
    assert "zhidao.player.settings.get" in sidecar

    # The final NSIS installer, not only the build-tree sidecar, is installed
    # into a fresh directory and exercised with Python removed from PATH.
    assert "studyflow-clean-install" in installer_test
    assert "System32" in installer_test
    assert "--packaged-runtime-self-test" in installer_test
    assert "yuketang.settings.get" in installer_test
    assert "Start-Process -FilePath $app.FullName" in installer_test
    assert "test-windows-install.ps1" in workflow
