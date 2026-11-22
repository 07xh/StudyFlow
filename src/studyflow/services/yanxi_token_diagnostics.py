"""Optional Yanxi credential diagnostics, isolated from account registration flows.

Only run when the user explicitly clicks an action. Never auto-check on import.
The provider's error-message based recognition is a heuristic, not a guaranteed
official validation contract. A balance lookup can consume one paid lookup.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from studyflow.services import yanxi_question_bank as yanxi

BASE = "https://tk.enncy.cn"
REPLY_LIMIT = 32_000


def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    if path not in ("/cloud/extract", "/cloud/batch-search"):
        raise ValueError("unsupported diagnostic path")
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json",
                 "Cache-Control": "no-store"},
    )
    try:
        with urllib.request.build_opener(yanxi._NoRedirect()).open(request, timeout=12) as response:
            raw = response.read(REPLY_LIMIT + 1)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise yanxi.QuestionBankError("YANXI_RATE_LIMITED") from None
        if exc.code in (301, 302, 303, 307, 308):
            raise yanxi.QuestionBankError("YANXI_REDIRECT_BLOCKED") from None
        if exc.code in (401, 403):
            raise yanxi.QuestionBankError("YANXI_TOKEN_REJECTED") from None
        raise yanxi.QuestionBankError("YANXI_UPSTREAM_UNAVAILABLE") from None
    except (OSError, TimeoutError, urllib.error.URLError):
        raise yanxi.QuestionBankError("YANXI_NETWORK_FAILED") from None
    if len(raw) > REPLY_LIMIT:
        raise yanxi.QuestionBankError("YANXI_BAD_RESPONSE")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError):
        raise yanxi.QuestionBankError("YANXI_BAD_RESPONSE") from None
    if not isinstance(data, dict):
        raise yanxi.QuestionBankError("YANXI_BAD_RESPONSE")
    return data


def check(token: str, *, include_quota: bool = False) -> dict[str, Any]:
    """Check one owned token. Quota reads are explicitly opted in and may cost 1 use.

    Return only status metadata; the token and service response are not exposed.
    Unrecognized messages and network failures are NOT treated as invalid keys.
    """
    secret = yanxi._valid_token(token)
    validity, reason, remaining = "unknown", "unrecognized_response", None
    try:
        data = _post("/cloud/extract", {"token": secret, "text": ""})
        msg = str(data.get("message") or data.get("msg") or "").casefold()
        if "token无效或用户不存在" in msg or "token无效" in msg:
            validity, reason = "invalid", "provider_rejected"
        elif "待识别内容为空" in msg or data.get("success") is True:
            validity, reason = "valid", "provider_recognized"
    except yanxi.QuestionBankError as exc:
        if exc.code == "YANXI_TOKEN_REJECTED":
            validity, reason = "invalid", "provider_rejected"
        elif exc.code == "YANXI_RATE_LIMITED":
            validity, reason = "unknown", "rate_limited"
        else:
            validity, reason = "unknown", "network_or_provider_error"

    quota_checked = False
    if include_quota and validity == "valid":
        # The provider may charge for this query; never do it without opt-in.
        try:
            detail = _post("/cloud/batch-search", {
                "token": secret, "questions": ["1+1=?"], "source_type": "question_bank",
            })
            payload = detail.get("data")
            payload = payload if isinstance(payload, dict) else {}
            count = payload.get("times")
            if type(count) is int and count >= 0:
                remaining, quota_checked = count, True
            else:
                reason = "balance_not_reported"
        except yanxi.QuestionBankError:
            reason = "balance_unavailable"
    return {"validity": validity, "reason": reason, "remaining": remaining,
            "quota_checked": quota_checked}
