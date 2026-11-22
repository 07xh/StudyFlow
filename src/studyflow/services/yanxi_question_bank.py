"""Local Yanxi question-bank adapter for the packaged Windows StudyFlow sidecar.

Only an explicit user-initiated lookup contacts Yanxi. No ZHS account data,
course IDs, Cookies, grades or credentials are sent upstream. The token is
stored on Windows using the current user's DPAPI, never in status.json.
"""
from __future__ import annotations

import ctypes
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from ctypes import wintypes
from pathlib import Path
from typing import Any

API_URL = "https://tk.enncy.cn/query"
STORE_PATH = (Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".studyflow")
              / "StudyFlow" / "question-bank" / "yanxi.dpapi")
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,256}$")
MAX_REPLY = 64_000


class QuestionBankError(ValueError):
    """Safe machine-readable error; never contains private request URLs."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _dpapi(data: bytes, *, protect: bool) -> bytes:
    if os.name != "nt":
        raise QuestionBankError("YANXI_WINDOWS_ONLY")
    buffer = ctypes.create_string_buffer(data, len(data))
    source = _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    result = _Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    func = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    # Avoid 32-bit pointer truncation on x64 Windows.
    func.argtypes = [ctypes.POINTER(_Blob), ctypes.c_void_p, ctypes.c_void_p,
                     ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
                     ctypes.POINTER(_Blob)]
    func.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not func(ctypes.byref(source), None, None, None, None, 0x1, ctypes.byref(result)):
        raise QuestionBankError("YANXI_TOKEN_STORAGE_FAILED")
    try:
        return ctypes.string_at(result.pbData, result.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(result.pbData, ctypes.c_void_p))


def _valid_token(token: Any) -> str:
    if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
        raise QuestionBankError("YANXI_INVALID_TOKEN")
    return token


def configured() -> dict[str, bool]:
    # No decryption and no network request during status checks.
    return {"configured": STORE_PATH.is_file()}


def save_token(value: Any) -> dict[str, bool]:
    token = _valid_token(value)
    encrypted = _dpapi(token.encode("ascii"), protect=True)
    try:
        STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = STORE_PATH.with_suffix(".tmp")
        with temporary.open("wb") as handle:
            handle.write(encrypted)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(STORE_PATH)
    except OSError as exc:
        raise QuestionBankError("YANXI_TOKEN_STORAGE_FAILED") from exc
    return {"configured": True}


def delete_token() -> dict[str, bool]:
    try:
        STORE_PATH.unlink(missing_ok=True)
    except OSError as exc:
        raise QuestionBankError("YANXI_TOKEN_STORAGE_FAILED") from exc
    return {"configured": False}


def _load_token() -> str:
    try:
        encrypted = STORE_PATH.read_bytes()
    except FileNotFoundError as exc:
        raise QuestionBankError("YANXI_NOT_CONFIGURED") from exc
    except OSError as exc:
        raise QuestionBankError("YANXI_TOKEN_STORAGE_FAILED") from exc
    if not encrypted or len(encrypted) > 4096:
        raise QuestionBankError("YANXI_TOKEN_STORAGE_FAILED")
    try:
        return _valid_token(_dpapi(encrypted, protect=False).decode("ascii"))
    except (UnicodeError, QuestionBankError) as exc:
        raise QuestionBankError("YANXI_TOKEN_STORAGE_FAILED") from exc


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A redirected query URL would contain the secret token.
        return None


def _field(value: Any, *, maximum: int, required: bool = False) -> str:
    if not isinstance(value, str):
        raise QuestionBankError("YANXI_INVALID_QUERY")
    text = value.strip()
    if len(text) > maximum or (required and not text):
        raise QuestionBankError("YANXI_INVALID_QUERY")
    return text


def _parse_result(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise QuestionBankError("YANXI_BAD_RESPONSE")
    data = payload.get("data")
    data = data if isinstance(data, dict) else {}
    remaining = data.get("times")
    remaining = remaining if type(remaining) is int and remaining >= 0 else None
    raw_answer = data.get("answer")
    answer = raw_answer.strip()[:8000] if isinstance(raw_answer, str) else ""
    message = " ".join(str(payload.get(key) or "") for key in ("message", "msg", "error"))
    notice = (message + " " + answer).casefold()
    if any(term in notice for term in ("次数不足", "次数已用完", "余额不足", "额度不足")):
        raise QuestionBankError("YANXI_QUOTA_EXHAUSTED")
    if any(term in notice for term in ("token错误", "token无效", "无效token",
                                       "token已失效", "token不存在", "登录过期")):
        raise QuestionBankError("YANXI_TOKEN_REJECTED")
    # A textual error must not masquerade as a reference answer.
    if any(term in notice for term in ("未找到答案", "没有找到答案", "暂无答案", "未找到题目", "无匹配结果")):
        return {"found": False, "answer": "", "remaining": remaining,
                "status": "not_found"}
    # Public adapters disagree on 0/1 but both publish data.answer.
    # Never infer a successful lookup from the response code alone.
    if payload.get("code") not in (0, 1) or not answer:
        return {"found": False, "answer": "", "remaining": remaining,
                "status": "not_found"}
    return {"found": True, "answer": answer, "remaining": remaining,
            "status": "matched", "source": "yanxi_external_unverified"}


def search(title: Any, options: Any = "", question_type: Any = "") -> dict[str, Any]:
    stem = _field(title, maximum=4000, required=True)
    answers = _field(options, maximum=4000)
    kind = _field(question_type, maximum=40)
    token = _load_token()
    query = urllib.parse.urlencode({
        "token": token, "title": stem, "options": answers, "type": kind,
    })
    url = API_URL + "?" + query
    if len(url) > 11000:
        raise QuestionBankError("YANXI_INVALID_QUERY")
    request = urllib.request.Request(url, headers={"Accept": "application/json",
                                                   "Cache-Control": "no-store"})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=12) as response:
            if response.status != 200:
                raise QuestionBankError("YANXI_UPSTREAM_UNAVAILABLE")
            raw = response.read(MAX_REPLY + 1)
    except urllib.error.HTTPError as exc:
        if exc.code in (301, 302, 303, 307, 308):
            raise QuestionBankError("YANXI_REDIRECT_BLOCKED") from None
        if exc.code in (401, 403):
            raise QuestionBankError("YANXI_TOKEN_REJECTED") from None
        if exc.code == 429:
            raise QuestionBankError("YANXI_RATE_LIMITED") from None
        raise QuestionBankError("YANXI_UPSTREAM_UNAVAILABLE") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise QuestionBankError("YANXI_NETWORK_FAILED") from None
    if len(raw) > MAX_REPLY:
        raise QuestionBankError("YANXI_BAD_RESPONSE")
    try:
        return _parse_result(json.loads(raw.decode("utf-8")))
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, QuestionBankError):
            raise
        raise QuestionBankError("YANXI_BAD_RESPONSE") from exc
