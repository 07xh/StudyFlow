"""StudyFlow-owned ZHS 0.1.5 viewing options, independent of ~/.zhs/config.toml."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import tempfile

DEFAULTS = {"speed": 1.5, "limit_minutes": 0, "learn_optional": False}


def validate_settings(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError("INVALID_ZHS_SETTINGS")
    speed, minutes, optional = value["speed"], value["limit_minutes"], value["learn_optional"]
    if (isinstance(speed, bool) or not isinstance(speed, (float, int))
            or not math.isfinite(speed) or not 1.0 <= speed <= 2.0):
        raise ValueError("INVALID_ZHS_SETTINGS")
    if isinstance(minutes, bool) or not isinstance(minutes, int) or not 0 <= minutes <= 1440:
        raise ValueError("INVALID_ZHS_SETTINGS")
    if not isinstance(optional, bool):
        raise ValueError("INVALID_ZHS_SETTINGS")
    return {"speed": float(speed), "limit_minutes": minutes, "learn_optional": optional}


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
        return validate_settings(json.loads(path.read_text(encoding="utf-8")))
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
