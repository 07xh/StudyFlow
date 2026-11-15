"""Windows Credential Manager backed configuration for a user's own YKT login.

Credentials are never saved in the StudyFlow source tree or printed to stdout.
The original Rain Classroom installation and its .env remain unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os

SERVICE = "StudyFlow.RainClassroom"
ACCOUNT = "local-session"


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


def load() -> YuketangConfig | None:
    # Support the existing external environment without modifying legacy .env.
    existing = {
        "session_id": os.getenv("YKT_SESSION_ID", ""),
        "csrf_token": os.getenv("YKT_CSRF_TOKEN", ""),
        "classroom_id": os.getenv("YKT_CLASSROOM_ID", ""),
        "university_id": os.getenv("YKT_UNIVERSITY_ID", ""),
        "sign": os.getenv("YKT_SIGN", ""),
    }
    if all(existing[k] for k in ("session_id", "csrf_token", "classroom_id", "university_id")):
        return YuketangConfig.from_dict(existing)
    if os.name != "nt":
        return None
    try:
        import keyring
        blob = keyring.get_password(SERVICE, ACCOUNT)
        if not blob:
            return None
        return YuketangConfig.from_dict(json.loads(blob))
    except Exception:
        return None


def save(configuration: dict) -> None:
    cfg = YuketangConfig.from_dict(configuration)
    if os.name != "nt":
        raise RuntimeError("Credential storage requires Windows")
    import keyring
    keyring.set_password(SERVICE, ACCOUNT, json.dumps(cfg.__dict__, ensure_ascii=False))


def clear() -> None:
    if os.name != "nt":
        raise RuntimeError("Credential storage requires Windows")
    import keyring
    try:
        keyring.delete_password(SERVICE, ACCOUNT)
    except keyring.errors.PasswordDeleteError:
        pass


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
