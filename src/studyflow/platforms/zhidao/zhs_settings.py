"""StudyFlow-owned ZHS 0.1.5 viewing options, independent of ~/.zhs/config.toml."""
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path
import tempfile

DEFAULTS = {
    "speed": 1.5, "speed_cap": 2.0, "limit_minutes": 0,
    "learn_optional": False, "max_videos": 0, "stop_on_error": False,
    "concurrency": 2,
    # None follows the original ZHS course-type default; overrides are course-scoped.
    "completion_threshold": None,
}
MAX_SELECTED = 256


def validate_run_settings(value: object) -> dict:
    if isinstance(value, dict):
        value = {"concurrency": 1, "completion_threshold": None, **value}
    required = set(DEFAULTS) | {"scope_mode", "selected_ids"}
    allowed = required | {"resource_mode", "requirement_mode"}
    if not isinstance(value, dict) or not required.issubset(value) or not set(value).issubset(allowed):
        raise ValueError("INVALID_ZHS_SETTINGS")
    base = validate_settings({key: value[key] for key in DEFAULTS})
    mode, identifiers = value["scope_mode"], value["selected_ids"]
    resource_mode = value.get("resource_mode", "all")
    requirement_mode = value.get("requirement_mode", "both" if base["learn_optional"] else "required")
    if resource_mode not in ("all", "video", "reading"):
        raise ValueError("INVALID_ZHS_SETTINGS")
    if requirement_mode not in ("required", "optional", "both"):
        raise ValueError("INVALID_ZHS_SETTINGS")
    # The original ZHS flag still decides whether optional resources can run;
    # reject contradictory UI and bridge inputs instead of silently broadening scope.
    if base["learn_optional"] != (requirement_mode != "required"):
        raise ValueError("INVALID_ZHS_SETTINGS")
    if mode not in ("all", "selected") or not isinstance(identifiers, list):
        raise ValueError("INVALID_ZHS_SETTINGS")
    if (len(identifiers) > MAX_SELECTED
            or any(type(i) is not int or i <= 0 or i > 2**63 - 1 for i in identifiers)
            or len(identifiers) != len(set(identifiers))
            or (mode == "all" and identifiers)
            or (mode == "selected" and not identifiers)):
        raise ValueError("INVALID_ZHS_SETTINGS")
    return {**base, "scope_mode": mode, "selected_ids": identifiers,
            "resource_mode": resource_mode, "requirement_mode": requirement_mode}


def validate_settings(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError("INVALID_ZHS_SETTINGS")
    speed, minutes, optional = value["speed"], value["limit_minutes"], value["learn_optional"]
    cap, maximum, stop = value["speed_cap"], value["max_videos"], value["stop_on_error"]
    threshold = value["completion_threshold"]
    if (isinstance(speed, bool) or not isinstance(speed, (float, int))
            or not math.isfinite(speed) or not 1.0 <= speed <= 2.0):
        raise ValueError("INVALID_ZHS_SETTINGS")
    if isinstance(minutes, bool) or not isinstance(minutes, int) or not 0 <= minutes <= 1440:
        raise ValueError("INVALID_ZHS_SETTINGS")
    if (type(cap) not in (float, int) or not math.isfinite(cap) or not 1.0 <= cap <= 2.0
            or type(value["concurrency"]) is not int or not 1 <= value["concurrency"] <= 3
            or type(maximum) is not int or not 0 <= maximum <= 1000
            or type(stop) is not bool or not isinstance(optional, bool)):
        raise ValueError("INVALID_ZHS_SETTINGS")
    if threshold is not None and (type(threshold) is not int or not 1 <= threshold <= 100):
        raise ValueError("INVALID_ZHS_SETTINGS")
    return {"speed": float(speed), "speed_cap": float(cap),
            "limit_minutes": minutes, "learn_optional": optional,
            "max_videos": maximum, "stop_on_error": stop,
            "concurrency": value["concurrency"], "completion_threshold": threshold}


def _path(course_key: str | None = None) -> Path:
    root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    folder = root / "StudyFlow" / "zhidao"
    if course_key is None:
        return folder / "zhs-task-settings.json"
    if not isinstance(course_key, str) or re.fullmatch(r"[a-f0-9]{64}", course_key) is None:
        raise ValueError("INVALID_COURSE")
    return folder / "zhs-course-settings" / (course_key + ".json")


def read_settings(course_key: str | None = None) -> dict:
    path = _path(course_key)
    if path.is_symlink():
        raise OSError("ZHS_SETTINGS_UNAVAILABLE")
    try:
        if path.stat().st_size > 4096:
            raise OSError("ZHS_SETTINGS_UNAVAILABLE")
        raw = json.loads(path.read_text(encoding="utf-8"))
        # Migrate older complete and three-property settings in place. Reject unknown keys.
        if isinstance(raw, dict) and set(raw).issubset(DEFAULTS):
            raw = {**DEFAULTS, "concurrency": 1, **raw}
        return validate_settings(raw)
    except FileNotFoundError:
        return read_settings() if course_key is not None else dict(DEFAULTS)


def save_settings(value: object, course_key: str | None = None) -> dict:
    settings = validate_settings(value)
    path = _path(course_key)
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
