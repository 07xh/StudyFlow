"""Local StudyFlow preferences for the Xuexitong task adapter.

Settings do not start tasks. A future independently supplied runner can
consume this validated contract without modifying the shared UI.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DEFAULTS = {
    "playback_speed": 1.0,
    "concurrency": 2,
    "skip_completed": True,
    "verify_after_run": True,
}


def validate(raw: object) -> dict[str, float | int | bool]:
    if not isinstance(raw, dict) or set(raw) != set(DEFAULTS):
        raise ValueError("INVALID_XUEXITONG_SETTINGS")
    speed = raw["playback_speed"]
    concurrency = raw["concurrency"]
    skip = raw["skip_completed"]
    verify = raw["verify_after_run"]
    if (type(speed) not in (int, float) or not 0.25 <= speed <= 2.0
            or type(concurrency) is not int or not 1 <= concurrency <= 4
            or type(skip) is not bool or type(verify) is not bool):
        raise ValueError("INVALID_XUEXITONG_SETTINGS")
    return {
        "playback_speed": float(speed),
        "concurrency": concurrency,
        "skip_completed": skip,
        "verify_after_run": verify,
    }


def _path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share")
    return base / "StudyFlow" / "xuexitong-settings-v1.json"


def read() -> dict[str, float | int | bool]:
    path = _path()
    try:
        status = path.lstat()
    except FileNotFoundError:
        # Only a genuinely absent settings file should load defaults.
        return DEFAULTS.copy()
    except OSError as exc:
        raise OSError("XUEXITONG_SETTINGS_UNAVAILABLE") from exc
    if path.is_symlink() or status.st_size > 4096:
        raise OSError("XUEXITONG_SETTINGS_UNAVAILABLE")
    try:
        return validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError) as exc:
        # Never replace unreadable/corrupted user preferences with defaults:
        # doing so would allow an innocent later save to overwrite them.
        raise OSError("XUEXITONG_SETTINGS_UNAVAILABLE") from exc


def save(raw: Any) -> dict[str, float | int | bool]:
    result = validate(raw)
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise OSError("XUEXITONG_SETTINGS_UNAVAILABLE")
    if path.exists():
        # Refuse a write over an unreadable previous configuration. A dedicated
        # reset/repair action must be explicit; a normal Save is not a reset.
        read()
    import uuid
    tmp = path.parent / (".xuexitong-settings-" + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return result
