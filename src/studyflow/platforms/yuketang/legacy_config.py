"""Direct adapter to the original Rain Classroom exe_entry.py configuration.

The original read_cfg/save_cfg functions own .env parsing and persistence.
StudyFlow only maps their values to typed UI settings; main.py and its runtime
remain unchanged.
"""
from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path
import sys
from typing import Any


DEFAULTS = {
    "VIDEO_SPEED": "1.5",
    "HEARTBEAT_INTERVAL": "5",
    "MAX_CONCURRENT_VIDEOS": "3",
    "COMPLETION_THRESHOLD": "90",
    "SKIP_COMPLETED": "true",
    "USE_CONCURRENT": "true",
    "TEST_MODE": "false",
    "TEST_VIDEO_COUNT": "5",
    "AUTO_RICHTEXT": "false",
}
FIELDS = {
    "video_speed": "VIDEO_SPEED",
    "heartbeat_interval": "HEARTBEAT_INTERVAL",
    "max_concurrent_videos": "MAX_CONCURRENT_VIDEOS",
    "completion_threshold": "COMPLETION_THRESHOLD",
    "skip_completed": "SKIP_COMPLETED",
    "use_concurrent": "USE_CONCURRENT",
    "test_mode": "TEST_MODE",
    "test_video_count": "TEST_VIDEO_COUNT",
    "auto_richtext": "AUTO_RICHTEXT",
}


def _project_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parents[4]


def config_home() -> Path:
    existing = os.environ.get("YKT_HOME")
    if existing:
        root = Path(existing).expanduser()
    else:
        local = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        root = local / "StudyFlow" / "legacy-logs"
    root.mkdir(parents=True, exist_ok=True)
    os.environ["YKT_HOME"] = str(root)
    return root


def _launcher():
    path = _project_root() / "legacy" / "yuketang" / "exe_entry.py"
    if not path.is_file():
        raise RuntimeError("Original Rain Classroom launcher is missing")
    spec = importlib.util.spec_from_file_location("studyflow_original_yuketang_entry", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Original Rain Classroom launcher cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _raw_config() -> dict[str, str]:
    config_home()
    raw = _launcher().read_cfg()
    if not isinstance(raw, dict):
        raise RuntimeError("Original Rain Classroom configuration is invalid")
    return {**DEFAULTS, **{str(k): str(v) for k, v in raw.items()}}


def _number(raw: dict[str, str], key: str, default: float, minimum: float, maximum: float, integer: bool = False):
    try:
        value = float(raw.get(key, str(default)))
        if not math.isfinite(value) or not minimum <= value <= maximum:
            return int(default) if integer else default
        if integer:
            return int(value) if value.is_integer() else int(default)
        return value
    except (TypeError, ValueError):
        return int(default) if integer else default


def _boolean(raw: dict[str, str], key: str, default: bool) -> bool:
    value = raw.get(key, str(default)).strip().lower()
    if value in ("true", "1", "yes", "on"):
        return True
    if value in ("false", "0", "no", "off"):
        return False
    return default


def read_settings() -> dict[str, Any]:
    raw = _raw_config()
    return {
        "video_speed": _number(raw, "VIDEO_SPEED", 1.5, 0.1, 4.0),
        "heartbeat_interval": _number(raw, "HEARTBEAT_INTERVAL", 5, 1, 120, True),
        "max_concurrent_videos": _number(raw, "MAX_CONCURRENT_VIDEOS", 3, 1, 32, True),
        "completion_threshold": _number(raw, "COMPLETION_THRESHOLD", 90, 0, 100, True),
        "skip_completed": _boolean(raw, "SKIP_COMPLETED", True),
        "use_concurrent": _boolean(raw, "USE_CONCURRENT", True),
        "test_mode": _boolean(raw, "TEST_MODE", False),
        "test_video_count": _number(raw, "TEST_VIDEO_COUNT", 5, 1, 10000, True),
        "auto_richtext": _boolean(raw, "AUTO_RICHTEXT", False),
    }


def _validated(settings: Any) -> dict[str, str]:
    if not isinstance(settings, dict):
        raise ValueError("INVALID_SETTINGS")
    expected = set(FIELDS)
    if set(settings) != expected:
        raise ValueError("INVALID_SETTINGS")

    values: dict[str, str] = {}
    for field in ("video_speed", "heartbeat_interval", "max_concurrent_videos",
                  "completion_threshold", "test_video_count"):
        value = settings[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise ValueError("INVALID_SETTINGS")
        limits = {
            "video_speed": (0.1, 4.0, False),
            "heartbeat_interval": (1, 120, True),
            "max_concurrent_videos": (1, 32, True),
            "completion_threshold": (0, 100, True),
            "test_video_count": (1, 10000, True),
        }
        low, high, integer = limits[field]
        if not low <= float(value) <= high or (integer and not float(value).is_integer()):
            raise ValueError("INVALID_SETTINGS")
        values[FIELDS[field]] = str(int(value) if integer else float(value))

    for field in ("skip_completed", "use_concurrent", "test_mode", "auto_richtext"):
        value = settings[field]
        if not isinstance(value, bool):
            raise ValueError("INVALID_SETTINGS")
        values[FIELDS[field]] = "true" if value else "false"
    return values


def save_settings(settings: Any) -> dict[str, Any]:
    changes = _validated(settings)
    config_home()
    _launcher().save_cfg(changes)
    return read_settings()


def prepare_environment() -> Path:
    """Load original launcher settings without overriding explicit UI options."""
    root = config_home()
    for key, value in _raw_config().items():
        if isinstance(key, str) and isinstance(value, str):
            os.environ.setdefault(key, value)
    return root
