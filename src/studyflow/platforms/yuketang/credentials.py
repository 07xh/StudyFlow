"""Windows DPAPI backed configuration for a user's own YKT login.

Credentials are never saved in the StudyFlow source tree or printed to stdout.
The original Rain Classroom installation and its .env remain unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os

SERVICE = "StudyFlow.RainClassroom"
ACCOUNT = "local-session"

from studyflow.services.session_storage import SessionStore, SessionStorageError


def _store():
    return SessionStore("yuketang", SERVICE, ACCOUNT)


@dataclass(frozen=True)
class YuketangConfig:
    session_id: str
    csrf_token: str
    classroom_id: str
    university_id: str
    sign: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> "YuketangConfig":
        if not isinstance(data, dict):
            raise ValueError("Invalid Rain Classroom configuration")
        def field(key: str, limit: int = 512) -> str:
            value = data.get(key, "")
            if not isinstance(value, str) or not value.strip() or len(value) > limit:
                raise ValueError("Invalid " + key)
            return value.strip()
        classroom_id, university_id = field("classroom_id", 24), field("university_id", 24)
        if not classroom_id.isdecimal() or not university_id.isdecimal():
            raise ValueError("Classroom and university IDs must be numeric")
        sign = data.get("sign", "")
        if not isinstance(sign, str) or len(sign) > 2048:
            raise ValueError("Invalid sign")
        return cls(session_id=field("session_id", 4096), csrf_token=field("csrf_token", 4096),
                   classroom_id=classroom_id, university_id=university_id, sign=sign)


def _environment_config() -> YuketangConfig | None:
    existing = {
        "session_id": os.getenv("YKT_SESSION_ID", ""),
        "csrf_token": os.getenv("YKT_CSRF_TOKEN", ""),
        "classroom_id": os.getenv("YKT_CLASSROOM_ID", ""),
        "university_id": os.getenv("YKT_UNIVERSITY_ID", ""),
        "sign": os.getenv("YKT_SIGN", ""),
    }
    try:
        return YuketangConfig.from_dict(existing)
    except ValueError:
        return None


def _decode(value: str) -> YuketangConfig:
    return YuketangConfig.from_dict(json.loads(value))


def load() -> YuketangConfig | None:
    existing = _environment_config()
    if os.name != "nt":
        return existing
    fallback = json.dumps(existing.__dict__, ensure_ascii=False) if existing else None
    blob = _store().load(fallback=fallback, validate=_decode)
    if blob is None:
        return None
    try:
        return _decode(blob)
    except (ValueError, TypeError):
        raise SessionStorageError() from None


def save(configuration: dict) -> None:
    cfg = YuketangConfig.from_dict(configuration)
    if os.name != "nt":
        raise SessionStorageError()
    _store().save(json.dumps(cfg.__dict__, ensure_ascii=False))


def clear() -> None:
    if os.name != "nt":
        raise SessionStorageError()
    _store().clear()


def scope_metadata(config: YuketangConfig | None) -> dict:
    return {"classroom_id": config.classroom_id if config else "",
            "university_id": config.university_id if config else "",
            "has_session": config is not None, "has_sign": bool(config and config.sign)}


def save_scope(scope: dict) -> dict:
    current = load()
    if current is None:
        raise LookupError("No saved session")
    if not isinstance(scope, dict) or not set(scope) <= {"classroom_id", "university_id", "sign"}:
        raise ValueError("Invalid classroom scope")
    if not {"classroom_id", "university_id"} <= set(scope):
        raise ValueError("Missing classroom scope")
    updated = YuketangConfig.from_dict({**current.__dict__, **scope})
    save(updated.__dict__)
    return scope_metadata(updated)


def recovery_marker(config: YuketangConfig | None) -> str | None:
    """Opaque, per-install HMAC of current authenticated session and scope."""
    if config is None:
        return None
    import hashlib
    import hmac
    from pathlib import Path
    import secrets

    root = Path(os.getenv("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "StudyFlow"
    root.mkdir(parents=True, exist_ok=True)
    key_path = root / "yuketang-recovery-salt.bin"
    try:
        key = key_path.read_bytes()
    except FileNotFoundError:
        try:
            fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            key = key_path.read_bytes()
        else:
            with os.fdopen(fd, "wb") as out:
                out.write(secrets.token_bytes(32))
                out.flush()
                os.fsync(out.fileno())
            key = key_path.read_bytes()
    if len(key) != 32:
        raise ValueError("Invalid local recovery salt")
    material = "\0".join((config.session_id, config.csrf_token, config.sign,
                          config.classroom_id, config.university_id)).encode("utf-8")
    return hmac.new(key, material, hashlib.sha256).hexdigest()
