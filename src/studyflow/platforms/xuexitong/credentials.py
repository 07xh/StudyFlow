"""Windows DPAPI storage for the user's own Xuexitong session."""
from __future__ import annotations

import os
import re

SERVICE = "StudyFlow.Xuexitong"
ACCOUNT = "local-session"

from studyflow.services.session_storage import SessionStore, SessionStorageError


def _store():
    return SessionStore("xuexitong", SERVICE, ACCOUNT)
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
    # On Windows the encrypted store and its logout marker are authoritative.
    if os.name == "nt":
        value = _store().load(validate=parse_cookie_header)
    else:
        value = os.environ.get("STUDYFLOW_XUEXITONG_COOKIE")
    if not value:
        return None
    try:
        return parse_cookie_header(value)
    except ValueError:
        if os.name == "nt":
            raise SessionStorageError() from None
        return None


def save(value: str) -> None:
    parse_cookie_header(value)
    if os.name != "nt":
        raise SessionStorageError()
    _store().save(value)


def clear() -> None:
    if os.name != "nt":
        raise SessionStorageError()
    _store().clear()
