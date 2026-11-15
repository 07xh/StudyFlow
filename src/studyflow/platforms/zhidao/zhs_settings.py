"""StudyFlow-owned ZHS 0.1.5 viewing options, independent of ~/.zhs/config.toml."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import tempfile

DEFAULTS = {
    "speed": 1.5, "speed_cap": 2.0, "limit_minutes": 0,
    "learn_optional": False, "max_videos": 0, "stop_on_error": False,
}
MAX_SELECTED = 256


def validate_run_settings(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != set(DEFAULTS) | {"scope_mode", "selected_ids"}:
        raise ValueError("INVALID_ZHS_SETTINGS")
    base = validate_settings({key: value[key] for key in DEFAULTS})
    mode, identifiers = value["scope_mode"], value["selected_ids"]
    if mode not in ("all", "selected") or not isinstance(identifiers, list):
        raise ValueError("INVALID_ZHS_SETTINGS")
    if (len(identifiers) > MAX_SELECTED
            or any(type(i) is not int or i <= 0 or i > 2**63 - 1 for i in identifiers)
            or len(identifiers) != len(set(identifiers))
            or (mode == "all" and identifiers)
            or (mode == "selected" and not identifiers)):
        raise ValueError("INVALID_ZHS_SETTINGS")
    return {**base, "scope_mode": mode, "selected_ids": identifiers}


def validate_settings(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError("INVALID_ZHS_SETTINGS")
    speed, minutes, optional = value["speed"], value["limit_minutes"], value["learn_optional"]
    cap, maximum, stop = value["speed_cap"], value["max_videos"], value["stop_on_error"]
    if (isinstance(speed, bool) or not isinstance(speed, (float, int))
            or not math.isfinite(speed) or not 1.0 <= speed <= 2.0):
        raise ValueError("INVALID_ZHS_SETTINGS")
    if isinstance(minutes, bool) or not isinstance(minutes, int) or not 0 <= minutes <= 1440:
        raise ValueError("INVALID_ZHS_SETTINGS")
    if (type(cap) not in (float, int) or not math.isfinite(cap) or not 1.0 <= cap <= 2.0
            or type(maximum) is not int or not 0 <= maximum <= 1000
            or type(stop) is not bool or not isinstance(optional, bool)):
        raise ValueError("INVALID_ZHS_SETTINGS")
    return {"speed": float(speed), "speed_cap": float(cap),
            "limit_minutes": minutes, "learn_optional": optional,
            "max_videos": maximum, "stop_on_error": stop}


def _path() -> Path:
    root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    return root / "StudyFlow" / "zhidao" / "zhs-task-settings.json"


def read_settings() -> dict:
    path = _path()
    if path.is_symlink():
        raise OSError("ZHS_SETTINGS_UNAVAILABLE")
    try:
        if path.stat().st_size > 4096:
            raise OSError("ZHS_SETTINGS_UNAVAILABLE")
        raw = json.loads(path.read_text(encoding="utf-8"))
        # Migrate PR #64's three-property local draft without deleting preferences.
        if isinstance(raw, dict) and set(raw) == {"speed", "limit_minutes", "learn_optional"}:
            raw = {**DEFAULTS, **raw}
        return validate_settings(raw)
    except FileNotFoundError:
        return dict(DEFAULTS)


def save_settings(value: object) -> dict:
    settings = validate_settings(value)
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise OSError("ZHS_SETTINGS_UNAVAILABLE")
    fd, temporary = tempfile.mkstemp(prefix=".zhs-task-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(settings, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return settings
