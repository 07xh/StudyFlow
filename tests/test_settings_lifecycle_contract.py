"""Offline settings lifecycle contract for every persisted StudyFlow parameter.

This verifies save -> fresh read -> a *new sidecar process* reading the same
user-scoped files. It does NOT claim to exercise a Windows GUI close/reopen,
a genuine studyflow.exe restart, or platform playback/learning acceptance.
Those remain separate release gates; see docs/SETTINGS_LIFECYCLE_ACCEPTANCE.md.
No platform account, course, heartbeat or network operation is invoked.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from studyflow.services import bridge


# Each platform field must have an example different from the initial default.
# Adding a persisted field without adding a case is an intentional test failure.
CASES = [
    (
        "official",
        "zhidao.player.settings",
        {},
        {
            "speed": "2",
            "allowMinimize": False,
            "autoStart": False,
            "autoNext": False,
            "mode": "zhs-original",
        },
        ("speed", "9"),
    ),
    (
        "zhs",
        "zhidao.zhs.settings",
        {"course_key": "a" * 64},
        {
            "speed": 1.25,
            "speed_cap": 1.75,
            "limit_minutes": 37,
            "learn_optional": True,
            "max_videos": 7,
            "stop_on_error": True,
            "concurrency": 3,
            "completion_threshold": 80,
        },
        ("concurrency", 99),
    ),
    (
        "rain-classroom",
        "yuketang.settings",
        {},
        {
            "video_speed": 1.75,
            "heartbeat_interval": 9,
            "max_concurrent_videos": 5,
            "completion_threshold": 85,
            "skip_completed": False,
            "use_concurrent": False,
            "test_mode": True,
            "test_video_count": 8,
            "auto_richtext": True,
            "debug": True,
            "richtext_stay_seconds": 9,
            "richtext_skip_delay": 2.25,
        },
        ("max_concurrent_videos", 99),
    ),
    (
        "xuexitong",
        "xuexitong.settings",
        {},
        {
            "playback_speed": 1.75,
            "concurrency": 3,
            "skip_completed": False,
            "verify_after_run": False,
        },
        ("concurrency", 99),
    ),
]


def _dispatch(operation: str, scope: dict, settings: dict | None = None) -> dict:
    request = {"id": "settings-contract", "version": 1, "operation": operation, **scope}
    if settings is not None:
        request["settings"] = settings
    return bridge.dispatch(request)


def _assert_fields(actual: dict, expected: dict) -> None:
    assert set(actual) == set(expected), "Unexpected missing/extra persisted settings"
    for field, value in expected.items():
        assert actual[field] == value, f"Round-trip mismatch: {field}"
        assert type(actual[field]) is type(value), f"Type drift after round-trip: {field}"


def _read_in_new_sidecar_process(operation: str, scope: dict) -> dict:
    """A new Python interpreter has no access to the previous in-memory state."""
    request = {"id": "restart", "version": 1, "operation": operation, **scope}
    code = (
        "import json,sys;"
        "from studyflow.services import bridge;"
        "print(json.dumps(bridge.dispatch(json.loads(sys.argv[1]))))"
    )
    env = os.environ.copy()
    project_root = Path(__file__).resolve().parents[1]
    env["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(project_root / "src"), env.get("PYTHONPATH", "")) if part
    )
    result = subprocess.run(
        [sys.executable, "-c", code, json.dumps(request)],
        capture_output=True, text=True, encoding="utf-8", env=env,
        check=True, timeout=30,
    )
    payload = json.loads(result.stdout.strip().splitlines()[-1])
    assert payload["ok"], payload
    return payload["data"]


@pytest.mark.parametrize("name,prefix,scope,changes,invalid", CASES, ids=[x[0] for x in CASES])
def test_each_persisted_parameter_survives_save_reopen_and_fresh_process(
    tmp_path, monkeypatch, name, prefix, scope, changes, invalid,
):
    # Keep tests entirely outside real user settings and original ZHS data.
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    monkeypatch.setenv("YKT_HOME", str(tmp_path / "yuketang"))

    original_response = _dispatch(prefix + ".get", scope)
    assert original_response["ok"], original_response
    original = original_response["data"]
    assert set(original) == set(changes), (
        f"{name}: new persisted fields must be added to the lifecycle contract"
    )

    current = original
    for field, example in changes.items():
        assert current[field] != example, (
            f"{name}.{field}: example must exercise an actual value change"
        )
        candidate = {**current, field: example}
        saved = _dispatch(prefix + ".save", scope, candidate)
        assert saved["ok"], f"{name}.{field}: save failed: {saved}"
        _assert_fields(saved["data"], candidate)

        # Equivalent to reopening settings from a new view, with NO cached draft.
        reopened = _dispatch(prefix + ".get", scope)
        assert reopened["ok"], f"{name}.{field}: reopen failed: {reopened}"
        _assert_fields(reopened["data"], candidate)
        current = candidate

    # A genuinely fresh interpreter reads all fields after in-memory state is gone.
    _assert_fields(_read_in_new_sidecar_process(prefix + ".get", scope), current)

    # Invalid input must never destroy the last known-good saved values.
    invalid_field, invalid_value = invalid
    rejected = _dispatch(prefix + ".save", scope, {**current, invalid_field: invalid_value})
    assert not rejected["ok"], f"{name}: invalid setting unexpectedly accepted"
    reread = _dispatch(prefix + ".get", scope)
    assert reread["ok"]
    _assert_fields(reread["data"], current)
    _assert_fields(_read_in_new_sidecar_process(prefix + ".get", scope), current)
