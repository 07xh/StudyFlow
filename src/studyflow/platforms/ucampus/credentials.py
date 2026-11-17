"""Windows Credential Manager storage of the user's own U校园 session."""
from __future__ import annotations

from dataclasses import dataclass
import base64
import json
import time
import os
import re
from urllib.parse import urlsplit

SERVICE = "StudyFlow.UCampus"
ACCOUNT = "local-session"
ALLOWED_HOSTS = {
    "ai": frozenset(("uai.unipus.cn", "ucloud.unipus.cn", "ucontent.unipus.cn")),
    "classic": frozenset(("u.unipus.cn", "ucontent.unipus.cn")),
}
# Public AI course route documented in the GPL-3.0 UnipusAI project,
# src/api/course.rs. It is not yet account-verified in StudyFlow.
AI_HOME_COURSES_URL = "https://uai.unipus.cn/api/cmgt/course/getHomeCourseListByStudent"
COOKIE_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$")


@dataclass(frozen=True)
class UCampusConfig:
    variant: str
    catalog_url: str
    cookie: str
    authorization: str = ""
    annotator_token: str = ""
    school_id: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> "UCampusConfig":
        if not isinstance(data, dict) or set(data) - {"variant", "catalog_url", "cookie", "authorization", "annotator_token", "school_id"}:
            raise ValueError("INVALID_UCAMPUS_CONFIG")
        variant, url, cookie = data.get("variant"), data.get("catalog_url"), data.get("cookie")
        if variant == "ai" and (url is None or url == ""):
            url = AI_HOME_COURSES_URL
        auth = data.get("authorization", "")
        annotator = data.get("annotator_token", "")
        school = data.get("school_id", "")
        if variant not in ALLOWED_HOSTS or not isinstance(url, str) or not 10 <= len(url) <= 2048:
            raise ValueError("INVALID_UCAMPUS_CONFIG")
        try:
            parsed = urlsplit(url)
            if (parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS[variant]
                    or parsed.username is not None or parsed.password is not None
                    or parsed.port is not None or parsed.fragment
                    or not parsed.path.startswith("/") or parsed.path == "/"
                    or any(ord(char) < 32 for char in url)):
                raise ValueError("INVALID_UCAMPUS_CONFIG")
        except ValueError as exc:
            raise ValueError("INVALID_UCAMPUS_CONFIG") from exc
        if (not isinstance(cookie, str) or not 1 <= len(cookie) <= 8192
                or any(c in cookie for c in "\r\n")):
            raise ValueError("INVALID_UCAMPUS_CONFIG")
        parts = [part.strip() for part in cookie.split(";") if part.strip()]
        if not parts or any("=" not in part or not COOKIE_NAME.fullmatch(part.split("=", 1)[0].strip())
                            or len(part.split("=", 1)[1]) > 4096 for part in parts):
            raise ValueError("INVALID_UCAMPUS_CONFIG")
        if not isinstance(auth, str) or len(auth) > 8192 or any(c in auth for c in "\r\n"):
            raise ValueError("INVALID_UCAMPUS_CONFIG")
        if (not isinstance(annotator, str) or len(annotator) > 4096
                or any(c in annotator for c in "\r\n")):
            raise ValueError("INVALID_UCAMPUS_CONFIG")
        if (not isinstance(school, str) or len(school) > 24
                or (school and not (school.isascii() and school.isdigit()))):
            raise ValueError("INVALID_UCAMPUS_CONFIG")
        return cls(variant=variant, catalog_url=url, cookie=cookie,
                   authorization=auth, annotator_token=annotator, school_id=school)


def load() -> UCampusConfig | None:
    if os.name != "nt":
        return None
    try:
        import keyring
        secret = keyring.get_password(SERVICE, ACCOUNT)
        return UCampusConfig.from_dict(json.loads(secret)) if secret else None
    except Exception:
        return None


def save(data: dict) -> None:
    config = UCampusConfig.from_dict(data)
    if os.name != "nt":
        raise RuntimeError("WINDOWS_CREDENTIAL_STORAGE_REQUIRED")
    import keyring
    keyring.set_password(SERVICE, ACCOUNT, json.dumps(config.__dict__, ensure_ascii=False))


def clear() -> None:
    if os.name != "nt":
        raise RuntimeError("WINDOWS_CREDENTIAL_STORAGE_REQUIRED")
    import keyring
    try:
        keyring.delete_password(SERVICE, ACCOUNT)
    except keyring.errors.PasswordDeleteError:
        pass


def _jwt_lifetime_state(config: UCampusConfig | None) -> str:
    """Unverified local exp hint, never a proof that the server accepts a JWT."""
    if config is None or config.variant != "ai":
        return "unknown"
    cookie_parts = (item.strip().split("=", 1) for item in config.cookie.split(";") if "=" in item)
    token = next((value for name, value in cookie_parts if name == "jwt"), "")
    segments = token.split(".")
    if len(segments) != 3 or not 1 <= len(segments[1]) <= 4096:
        return "unknown"
    try:
        decoded = base64.urlsafe_b64decode(segments[1] + "=" * (-len(segments[1]) % 4))
        if len(decoded) > 4096:
            return "unknown"
        payload = json.loads(decoded)
        exp = payload.get("exp") if isinstance(payload, dict) else None
        if type(exp) is not int or exp <= 0:
            return "unknown"
    except (ValueError, TypeError, UnicodeError):
        return "unknown"
    now = int(time.time())
    if exp <= now:
        return "expired"
    if exp <= now + 300:
        return "expiring"
    return "not_expired"


def status() -> dict:
    config = load()
    return {"configured": config is not None, "variant": config.variant if config else None,
            "jwt_lifetime": _jwt_lifetime_state(config)}
