"""U校园AI SSO login for the account owner; never store plaintext passwords.

Protocol evidence: Zzj-klwgxdz/UnipusAI (GPL-3.0),
src/api/login.rs at commit 937725ede225f63e7746f11c0ff6ac297e524909.
The API still requires validation with a real U校园AI account. Do not bypass
captcha/rate limits or infer authentication from locally generated data.
"""
from __future__ import annotations

import re

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

from dataclasses import replace

from .credentials import UCampusConfig

_SSO_LOGIN_URL = "https://sso.unipus.cn/sso/0.1/sso/cip/login"
_SERVICE = "https://uai.unipus.cn"
_KEY = bytes.fromhex("8AD70B641C024C7ADA2ECD082EC0334F")
_IV = bytes(range(1, 17))
_JWT = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$")


class UCampusLoginError(RuntimeError):
    """A fixed public error code, never the server body or an HTTP exception."""


def encrypt_field(value: str) -> str:
    """Replicate the public USSO SDK AES-CBC/PKCS7 field envelope."""
    padder = PKCS7(128).padder()
    plain = padder.update(value.encode("utf-8")) + padder.finalize()
    cipher = Cipher(algorithms.AES(_KEY), modes.CBC(_IV))
    encryptor = cipher.encryptor()
    return (encryptor.update(plain) + encryptor.finalize()).hex().upper()


def _validate(username: str, password: str) -> tuple[str, str]:
    if (not isinstance(username, str) or not isinstance(password, str)
            or not 1 <= len(username.strip()) <= 128
            or not 1 <= len(password) <= 256
            or any(char in username + password for char in "\r\n\x00")):
        raise UCampusLoginError("INVALID_UCAMPUS_LOGIN")
    return username.strip(), password


def authenticate(username: str, password: str) -> UCampusConfig:
    """Authenticate once to the fixed official SSO host, returning a session only.

    No username/password is persisted. An interactive CAPTCHA must be resolved
    through the provider rather than bypassed by this client.
    """
    user, secret = _validate(username, password)
    payload = {
        "username": encrypt_field(user),
        "password": encrypt_field(secret),
        "remember": True,
        "service": _SERVICE,
    }
    try:
        response = requests.post(
            _SSO_LOGIN_URL, json=payload,
            headers={"Accept": "application/json", "Origin": _SERVICE,
                     "Referer": _SERVICE + "/"},
            timeout=(5, 15), allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise UCampusLoginError("UCAMPUS_LOGIN_UNAVAILABLE") from exc

    if response.status_code == 429:
        raise UCampusLoginError("UCAMPUS_LOGIN_RATE_LIMITED")
    if response.status_code in (401, 403):
        raise UCampusLoginError("UCAMPUS_LOGIN_REJECTED")
    if response.status_code != 200 or response.is_redirect:
        raise UCampusLoginError("UCAMPUS_LOGIN_UNAVAILABLE")
    if (len(response.content) > 200_000
            or "json" not in response.headers.get("content-type", "").lower()):
        raise UCampusLoginError("UCAMPUS_LOGIN_FORMAT_UNVERIFIED")
    try:
        body = response.json()
    except ValueError as exc:
        raise UCampusLoginError("UCAMPUS_LOGIN_FORMAT_UNVERIFIED") from exc
    if not isinstance(body, dict):
        raise UCampusLoginError("UCAMPUS_LOGIN_FORMAT_UNVERIFIED")

    code = body.get("code")
    if str(code) != "0":
        if str(code) in {"1502", "1504", "1506", "1509"}:
            raise UCampusLoginError("UCAMPUS_LOGIN_VERIFICATION_REQUIRED")
        if str(code) == "1507":
            raise UCampusLoginError("UCAMPUS_LOGIN_RATE_LIMITED")
        raise UCampusLoginError("UCAMPUS_LOGIN_REJECTED")

    data = body.get("rs")
    if not isinstance(data, dict):
        raise UCampusLoginError("UCAMPUS_LOGIN_FORMAT_UNVERIFIED")
    jwt = data.get("jwt")
    if not isinstance(jwt, str) or not 10 <= len(jwt) <= 4096 or not _JWT.fullmatch(jwt):
        raise UCampusLoginError("UCAMPUS_LOGIN_FORMAT_UNVERIFIED")

    # Store only a JWT session. No account password or SSO refresh token.
    return UCampusConfig.from_dict({"variant": "ai", "cookie": "jwt=" + jwt})


# Observed in the public UnipusAI implementation, course.rs (read-only).
_ACCOUNT_USER_INFO_URL = "https://uai.unipus.cn/api/account/user/info"


def enrich_school_from_account(config: UCampusConfig) -> UCampusConfig:
    """Best-effort, read-only account profile lookup on the fixed first-party host.

    Missing/malformed/expired profile data never changes the valid SSO JWT session
    or invents a school identifier. This may be unavailable for some accounts.
    """
    if config.variant != "ai" or config.school_id:
        return config
    cookie_fields = dict(part.strip().split("=", 1)
                         for part in config.cookie.split(";") if "=" in part)
    jwt = cookie_fields.get("jwt", "")
    if not jwt or not _JWT.fullmatch(jwt):
        return config
    try:
        response = requests.get(
            _ACCOUNT_USER_INFO_URL,
            headers={"Accept": "application/json", "Cookie": config.cookie,
                     "Authorization": jwt, "u-app-id": "39", "u-platform": "2",
                     "Origin": _SERVICE, "Referer": _SERVICE + "/"},
            timeout=(5, 10), allow_redirects=False,
        )
        if response.status_code != 200 or response.is_redirect:
            return config
        if (len(response.content) > 200_000
                or "json" not in response.headers.get("content-type", "").lower()):
            return config
        data = response.json()
    except (requests.RequestException, ValueError):
        return config
    if not isinstance(data, dict) or (
            str(data.get("code")) != "1" and data.get("success") is not True):
        return config
    value = data.get("value")
    info = value.get("userInfo") if isinstance(value, dict) else None
    school = info.get("school") if isinstance(info, dict) else None
    if type(school) is int:
        school = str(school)
    if not isinstance(school, str) or not school.isascii() or not school.isdigit() or len(school) > 24:
        return config
    return replace(config, school_id=school)
