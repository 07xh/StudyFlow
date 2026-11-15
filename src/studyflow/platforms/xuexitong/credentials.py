"""Windows Credential Manager storage for the user's own Xuexitong session."""
from __future__ import annotations

import os
import re

SERVICE = "StudyFlow.Xuexitong"
ACCOUNT = "local-session"
_COOKIE_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$")


def parse_cookie_header(value: str) -> dict[str, str]:
    if not isinstance(value, str) or not 1 <= len(value) <= 8192 or any(c in value for c in "\r\n"):
        raise ValueError("INVALID_XUEXITONG_COOKIE")
    cookies = {}
    for pair in value.split(";"):
        pair = pair.strip()
        if not pair:
            continue
        if "=" not in pair:
            raise ValueError("INVALID_XUEXITONG_COOKIE")
        key, content = pair.split("=", 1)
        key = key.strip()
        content = content.strip()
        if not _COOKIE_NAME.fullmatch(key) or len(content) > 4096:
            raise ValueError("INVALID_XUEXITONG_COOKIE")
        cookies[key] = content
    if not cookies.get("_uid") and not cookies.get("UID"):
        raise ValueError("INVALID_XUEXITONG_COOKIE")
    return cookies


def load() -> dict[str, str] | None:
    # A packaged Windows app must only accept the user's Credential Manager
    # entry. Otherwise a stale inherited environment variable can silently
    # resurrect a session after the user explicitly clears their credentials.
    if os.name == "nt":
        try:
            import keyring
            value = keyring.get_password(SERVICE, ACCOUNT)
        except Exception:
            return None
    else:
        # Development-only fallback for offline and non-Windows tests.
        value = os.environ.get("STUDYFLOW_XUEXITONG_COOKIE")
    if not value:
        return None
    try:
        return parse_cookie_header(value)
    except ValueError:
        return None


def save(value: str) -> None:
    parse_cookie_header(value)
    if os.name != "nt":
        raise RuntimeError("WINDOWS_CREDENTIAL_STORAGE_REQUIRED")
    import keyring
    keyring.set_password(SERVICE, ACCOUNT, value)


def clear() -> None:
    if os.name != "nt":
        raise RuntimeError("WINDOWS_CREDENTIAL_STORAGE_REQUIRED")
    import keyring
    try:
        keyring.delete_password(SERVICE, ACCOUNT)
    except keyring.errors.PasswordDeleteError:
        pass
