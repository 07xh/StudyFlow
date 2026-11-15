"""ZHS task settings are independent from upstream and only pass official CLI flags."""
import math
import pytest
from studyflow.platforms.zhidao import zhs_settings
from studyflow.services import legacy_playback as legacy


def test_zhs_settings_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert zhs_settings.read_settings() == zhs_settings.DEFAULTS
    options = {"speed": 1.25, "limit_minutes": 30, "learn_optional": True}
    assert zhs_settings.save_settings(options) == options
    assert zhs_settings.read_settings() == options
    for invalid in (
        {"speed": math.inf, "limit_minutes": 30, "learn_optional": True},
        {"speed": 2.5, "limit_minutes": 30, "learn_optional": True},
        {"speed": 1.5, "limit_minutes": True, "learn_optional": False},
        {"speed": 1.5, "limit_minutes": -1, "learn_optional": False},
        {"speed": 1.5, "limit_minutes": 0, "learn_optional": 1},
        {**options, "heartbeat_interval": 1},
    ):
        with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
            zhs_settings.save_settings(invalid)
    assert zhs_settings.read_settings() == options


def test_zhs_cli_options_are_passed_to_original_typer(monkeypatch):
    monkeypatch.setattr(legacy, "_current_course_row",
                        lambda key: {"courseType": "ai", "courseId": "11", "classId": "22"})
    seen = []
    monkeypatch.setattr(legacy, "_run_bundled_zhs_args",
                        lambda arguments, token: seen.append((arguments, token)) or 0)
    options = {"speed": 1.25, "limit_minutes": 30, "learn_optional": True}
    assert legacy.run_zhidao_original("a" * 64, "b" * 32, options) == 0
    assert seen == [(["play", "-c", "11:22", "--type", "ai",
                     "--speed", "1.25", "--limit", "30", "--learn-optional"], "b" * 32)]


def test_zhs_refuses_invalid_worker_settings(monkeypatch):
    monkeypatch.setattr(legacy, "_current_course_row", lambda key: pytest.fail("Must not load course"))
    bad = {"speed": 1.5, "limit_minutes": 0, "learn_optional": False, "heartbeat_interval": 1}
    assert legacy.run_zhidao_original("a" * 64, None, bad) == 2
    assert legacy.main(["--legacy-zhidao", "a" * 64, "b" * 32, "{invalid"]) == 2
