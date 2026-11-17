"""Corrupted saved settings must not be reinterpreted as defaults.

The same failure must reach the IPC response, and a normal Save must not
overwrite the file. No account or network activity is involved.
"""
from __future__ import annotations

import json

import pytest

from studyflow.platforms.xuexitong import settings
from studyflow.services import bridge


@pytest.mark.parametrize("raw", ["{", "[]", '{"playback_speed":99}', '{"concurrency":2}'])
def test_corrupt_xuexitong_settings_fail_closed_and_preserve_bytes(
    tmp_path, monkeypatch, raw,
):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    path = settings._path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(raw, encoding="utf-8")

    with pytest.raises(OSError, match="XUEXITONG_SETTINGS_UNAVAILABLE"):
        settings.read()
    result = bridge.dispatch({
        "id": "read", "version": 1, "operation": "xuexitong.settings.get",
    })
    assert result == {
        "id": "read", "ok": False, "error": "XUEXITONG_SETTINGS_UNAVAILABLE",
    }

    with pytest.raises(OSError, match="XUEXITONG_SETTINGS_UNAVAILABLE"):
        settings.save(settings.DEFAULTS.copy())
    assert path.read_text(encoding="utf-8") == raw


def test_missing_xuexitong_settings_still_load_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert settings.read() == settings.DEFAULTS
    response = bridge.dispatch({
        "id": "read", "version": 1, "operation": "xuexitong.settings.get",
    })
    assert response["ok"] and response["data"] == settings.DEFAULTS
