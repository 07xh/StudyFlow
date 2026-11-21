"""ZHS task settings are independent from upstream and only pass official CLI flags."""
import math
import pytest
from studyflow.platforms.zhidao import zhs_settings
from studyflow.services import legacy_playback as legacy


def test_zhs_settings_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert zhs_settings.read_settings() == zhs_settings.DEFAULTS
    options = {**zhs_settings.DEFAULTS, "speed": 1.25, "limit_minutes": 30, "learn_optional": True}
    assert zhs_settings.save_settings(options) == options
    assert zhs_settings.read_settings() == options
    for invalid in (
        {**options, "speed": math.inf},
        {**options, "speed": 2.5},
        {**options, "limit_minutes": True},
        {**options, "limit_minutes": -1},
        {**options, "learn_optional": 1},
        {**options, "speed_cap": math.inf},
        {**options, "max_videos": -1},
        {**options, "heartbeat_interval": 1},
    ):
        with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
            zhs_settings.save_settings(invalid)
    assert zhs_settings.read_settings() == options


def test_scheduler_mode_is_opt_in_migrates_old_settings_and_rejects_invalid(tmp_path, monkeypatch):
    import json
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    original = {**zhs_settings.DEFAULTS, "parallel_mode": "resources"}
    assert zhs_settings.save_settings(original) == original
    assert zhs_settings.read_settings()["parallel_mode"] == "resources"
    path = tmp_path / "StudyFlow/zhidao/zhs-task-settings.json"
    legacy = {key: value for key, value in original.items() if key != "parallel_mode"}
    path.write_text(json.dumps(legacy), encoding="utf-8")
    assert zhs_settings.read_settings()["parallel_mode"] == "chapters"
    run = {**legacy, "scope_mode": "all", "selected_ids": []}
    assert zhs_settings.validate_run_settings(run)["parallel_mode"] == "chapters"
    for invalid in ("one-chapter", "all", None, True, 2):
        with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
            zhs_settings.save_settings({**original, "parallel_mode": invalid})
    assert zhs_settings.validate_run_settings({**run, "parallel_mode": "resources"})["parallel_mode"] == "resources"


def test_zhs_cli_options_are_passed_to_original_typer(monkeypatch):
    monkeypatch.setattr(legacy, "_current_course_row",
                        lambda key: {"courseType": "ai", "courseId": "11", "classId": "22"})
    seen = []
    monkeypatch.setattr(legacy, "_run_bundled_zhs_args",
                        lambda arguments, token, options, is_ai: seen.append((arguments, token, options, is_ai)) or 0)
    options = {**zhs_settings.DEFAULTS, "speed": 1.25, "limit_minutes": 30, "learn_optional": True,
               "scope_mode": "all", "selected_ids": []}
    assert legacy.run_zhidao_original("a" * 64, "b" * 32, options) == 0
    assert seen == [(["play", "-c", "11:22", "--type", "ai",
                     "--speed", "1.25", "--limit", "30", "--learn-optional"], "b" * 32, {**options, "resource_mode": "all"}, True)]


def test_zhs_refuses_invalid_worker_settings(monkeypatch):
    monkeypatch.setattr(legacy, "_current_course_row", lambda key: pytest.fail("Must not load course"))
    bad = {**zhs_settings.DEFAULTS, "scope_mode": "all", "selected_ids": [], "heartbeat_interval": 1}
    assert legacy.run_zhidao_original("a" * 64, None, bad) == 2
    assert legacy.main(["--legacy-zhidao", "a" * 64, "b" * 32, "{invalid"]) == 2



def test_scope_contract_rejects_unknown_and_duplicate_ids():
    original = {**zhs_settings.DEFAULTS, "scope_mode": "selected", "selected_ids": [1, 3]}
    assert zhs_settings.validate_run_settings(original)["selected_ids"] == [1, 3]
    for altered in (
        {**original, "selected_ids": []},
        {**original, "selected_ids": [1, 1]},
        {**original, "selected_ids": [-1]},
        {**original, "selected_ids": [True]},
        {**original, "scope_mode": "all"},
        {**original, "heartbeat_interval": 1},
    ):
        with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
            zhs_settings.validate_run_settings(altered)



def test_course_options_are_independent_and_reuse_global_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    first, second = "a" * 64, "b" * 64
    assert zhs_settings.read_settings(first) == zhs_settings.DEFAULTS
    course_setting = {**zhs_settings.DEFAULTS, "max_videos": 3, "stop_on_error": True}
    zhs_settings.save_settings(course_setting, first)
    assert zhs_settings.read_settings(first) == course_setting
    assert zhs_settings.read_settings(second) == zhs_settings.DEFAULTS
    with pytest.raises(ValueError, match="INVALID_COURSE"):
        zhs_settings.save_settings(course_setting, "../bad")


def test_resource_type_setting_is_per_run_and_fails_closed():
    original = {**zhs_settings.DEFAULTS, "scope_mode": "all", "selected_ids": []}
    assert zhs_settings.validate_run_settings(original)["resource_mode"] == "all"
    for mode in ("all", "video", "reading"):
        assert zhs_settings.validate_run_settings({**original, "resource_mode": mode})["resource_mode"] == mode
    for mode in ("videos", "ppt-only", True, None):
        with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
            zhs_settings.validate_run_settings({**original, "resource_mode": mode})


def test_zhs_threshold_is_course_specific_and_migrates_old_settings(tmp_path, monkeypatch):
    import json
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    first, second = "a" * 64, "b" * 64
    assert zhs_settings.read_settings(first)["completion_threshold"] is None
    custom = {**zhs_settings.DEFAULTS, "completion_threshold": 85}
    assert zhs_settings.save_settings(custom, first)["completion_threshold"] == 85
    assert zhs_settings.read_settings(second)["completion_threshold"] is None
    for value in (True, -1, 0, 101, 90.5, "90"):
        with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
            zhs_settings.save_settings({**custom, "completion_threshold": value}, first)
    old = {key: value for key, value in custom.items() if key != "completion_threshold"}
    root = tmp_path / "StudyFlow" / "zhidao"
    (root / "zhs-task-settings.json").write_text(json.dumps(old), encoding="utf-8")
    assert zhs_settings.read_settings()["completion_threshold"] is None


def test_zhs_runtime_applies_local_target_only_after_valid_session(monkeypatch):
    import sys
    from types import SimpleNamespace
    upstream = SimpleNamespace()
    config = SimpleNamespace(threshold=0.91, video=SimpleNamespace(ai_threshold=90))
    observed = []
    upstream._load_config_and_session = lambda *args, **kwargs: (config, object())
    monkeypatch.setitem(sys.modules, "zhs.__main__", upstream)
    with legacy._observe_zhs_cli_stages(80, is_ai=False):
        observed.append(upstream._load_config_and_session()[0].threshold)
    assert observed == [0.8]
    assert upstream._load_config_and_session()[0] is config
    assert config.video.ai_threshold == 90
    upstream._load_config_and_session = lambda *args, **kwargs: (config, object())
    with legacy._observe_zhs_cli_stages(95, is_ai=True):
        upstream._load_config_and_session()
    assert config.video.ai_threshold == 95
    assert config.threshold == 0.8
