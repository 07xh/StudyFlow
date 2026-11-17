"""Read-only U校园AI content request authentication for the signed-in user.

The public UnipusAI session implementation documents a separate client-side
x-annotator-auth-token for the U校园AI content APIs. This module reproduces
the *current public frontend protocol*, scoped only to the openId from the
already configured SSO JWT; it does not authenticate a user on its own.

The frontend signing parameters may change at any time. A generated token is
never treated as server acceptance; a real read-only content GET must pass.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

# Public frontend defaults recorded in UnipusAI src/api/login.rs.
# Do not use for logins or any account other than the configured session.
_ANNOTATOR_KEY = b"a824b379f126b8b7aa5e33dee83fb0a05aa7462c"
_ISSUER = "c4f772063dcfa98e9c50"
_AUDIENCE = "edx.unipus.cn"
_TTL_MS = 31_536_000_000


def _base64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def content_token(open_id: str, *, exp_ms: int | None = None) -> str:
    """Construct an ephemeral token for the current session's validated openId.

    This uses public client-app authentication metadata, not a verified user
    credential. The target service alone decides whether to accept it.
    """
    if (not isinstance(open_id, str) or not 1 <= len(open_id) <= 128
            or not open_id.isascii()
            or not all(char.isalnum() or char in "_-:+" for char in open_id)):
        raise ValueError("INVALID_UCAMPUS_OPEN_ID")
    if exp_ms is None:
        exp_ms = int(time.time() * 1000) + _TTL_MS
    if type(exp_ms) is not int or exp_ms <= 0:
        raise ValueError("INVALID_UCAMPUS_EXPIRY")
    header = _base64url(b'{"alg":"HS256","typ":"JWT"}')
    payload = _base64url(json.dumps({
        "open_id": open_id, "name": "", "email": "",
        "administrator": False, "exp": exp_ms,
        "iss": _ISSUER, "aud": _AUDIENCE,
    }, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))
    message = f"{header}.{payload}"
    sig = hmac.new(_ANNOTATOR_KEY, message.encode("ascii"), hashlib.sha256).digest()
    return f"{message}.{_base64url(sig)}"
