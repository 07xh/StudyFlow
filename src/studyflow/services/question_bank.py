"""Provider-neutral question-bank service for StudyFlow Windows Sidecar.

Any exercise UI may call query_question with an isolated question payload.
The configured provider adapter decides its remote protocol. Multi-token
secrets are encrypted with Windows DPAPI (current user), not stored in logs.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from studyflow.services import yanxi_question_bank as yanxi
from studyflow.services import yanxi_token_diagnostics as yanxi_diagnostics

ROOT = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".studyflow") / "StudyFlow" / "question-bank"
STORE_PATH = ROOT / "providers.dpapi"
MAX_TOKENS = 100
LOCK = threading.RLock()
QuestionBankError = yanxi.QuestionBankError

# Extend this registry with a provider adapter; UI and bridge remain unchanged.
PROVIDERS: dict[str, dict[str, Any]] = {
    "yanxi": {
        "name": "言溪题库",
        "homepage": "https://tk.enncy.cn/",
        "quota_unit": "次",
        "lookup": yanxi.search,
        "check": yanxi_diagnostics.check,
        "validate_token": yanxi._valid_token,
        "description": "Token 搜题接口",
    },
}


def _validate_provider_token(provider: str, token: Any) -> str:
    custom = PROVIDERS[provider].get("validate_token")
    if custom is not None:
        return custom(token)
    # Default contract for future API providers; their adapter may override.
    if (not isinstance(token, str) or not 8 <= len(token) <= 512
            or not all(33 <= ord(ch) <= 126 for ch in token)):
        raise QuestionBankError("QUESTIONBANK_INVALID_TOKEN")
    return token


def _state() -> dict[str, Any]:
    return {"version": 1, "tokens": [], "active": {}, "rotation_modes": {}, "cursors": {}}


def _check_provider(provider: Any) -> str:
    if not isinstance(provider, str) or provider not in PROVIDERS:
        raise QuestionBankError("QUESTIONBANK_UNKNOWN_PROVIDER")
    return provider


def _read() -> dict[str, Any]:
    if not STORE_PATH.is_file():
        # Migration from rc.57. The legacy DPAPI token remains valid under the
        # same Windows user; transfer it before deleting the legacy blob.
        if yanxi.STORE_PATH.is_file():
            token = yanxi._load_token()
            migrated = {"version": 1, "tokens": [{
                "id": uuid.uuid4().hex, "provider_id": "yanxi",
                "label": "原有言溪 Token", "token": token,
            }], "active": {}}
            migrated["active"]["yanxi"] = migrated["tokens"][0]["id"]
            _write(migrated)
            try:
                yanxi.STORE_PATH.unlink(missing_ok=True)
            except OSError:
                # The encrypted legacy copy can be deleted on a later upgrade.
                pass
            return migrated
        return _state()
    try:
        raw = STORE_PATH.read_bytes()
        if not raw or len(raw) > 250_000:
            raise ValueError("invalid blob")
        data = json.loads(yanxi._dpapi(raw, protect=False).decode("utf-8"))
        if (not isinstance(data, dict) or data.get("version") != 1
                or not isinstance(data.get("tokens"), list)
                or not isinstance(data.get("active"), dict)
                or len(data["tokens"]) > MAX_TOKENS * len(PROVIDERS)):
            raise ValueError("invalid schema")
        for item in data["tokens"]:
            if (not isinstance(item, dict)
                    or not isinstance(item.get("id"), str)
                    or not isinstance(item.get("label"), str)
                    or item.get("provider_id") not in PROVIDERS):
                raise ValueError("invalid token row")
            _validate_provider_token(item["provider_id"], item.get("token"))
        # Backward compatible with existing v1 DPAPI vaults.
        modes = data.setdefault("rotation_modes", {})
        cursors = data.setdefault("cursors", {})
        if (not isinstance(modes, dict) or not isinstance(cursors, dict)
                or any(key not in PROVIDERS or mode not in ("fixed", "round_robin")
                       for key, mode in modes.items())
                or any(key not in PROVIDERS or type(index) is not int or index < 0
                       for key, index in cursors.items())):
            raise ValueError("invalid rotation state")
        return data
    except (OSError, ValueError, UnicodeError, QuestionBankError) as exc:
        raise QuestionBankError("QUESTIONBANK_STORAGE_FAILED") from exc


def _write(data: dict[str, Any]) -> None:
    try:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        encrypted = yanxi._dpapi(payload, protect=True)
        STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = STORE_PATH.with_suffix(".tmp")
        with temporary.open("wb") as handle:
            handle.write(encrypted)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(STORE_PATH)
    except (OSError, QuestionBankError) as exc:
        raise QuestionBankError("QUESTIONBANK_STORAGE_FAILED") from exc


def _public(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "providers": [{"id": key, "name": item["name"], "description": item["description"],
                       "homepage": item.get("homepage"), "quota_unit": item.get("quota_unit", "次") }
                      for key, item in PROVIDERS.items()],
        "rotation_modes": {key: data.get("rotation_modes", {}).get(key, "fixed") for key in PROVIDERS},
        "tokens": [{"id": item["id"], "provider_id": item["provider_id"],
                    "label": item["label"],
                    "active": data["active"].get(item["provider_id"]) == item["id"],
                    "validity": item.get("validity", "unchecked"),
                    "checked_at": item.get("checked_at"),
                    "remaining": item.get("remaining"),
                    "balance_at": item.get("balance_at"),
                    "check_reason": item.get("check_reason")}
                   for item in data["tokens"]],
    }


def list_tokens() -> dict[str, Any]:
    with LOCK:
        return _public(_read())


def add_token(provider_id: Any, label: Any, token: Any) -> dict[str, Any]:
    provider = _check_provider(provider_id)
    if not isinstance(label, str) or not 1 <= len(label.strip()) <= 50:
        raise QuestionBankError("QUESTIONBANK_INVALID_LABEL")
    secret = _validate_provider_token(provider, token)
    with LOCK:
        data = _read()
        provider_tokens = [item for item in data["tokens"] if item["provider_id"] == provider]
        if len(provider_tokens) >= MAX_TOKENS:
            raise QuestionBankError("QUESTIONBANK_TOKEN_LIMIT")
        if any(item["token"] == secret for item in provider_tokens):
            raise QuestionBankError("QUESTIONBANK_TOKEN_DUPLICATE")
        item_id = uuid.uuid4().hex
        data["tokens"].append({"id": item_id, "provider_id": provider,
                               "label": label.strip(), "token": secret})
        if not data["active"].get(provider):
            data["active"][provider] = item_id
        _write(data)
        return _public(data)


def import_tokens(provider_id: Any, lines: Any) -> dict[str, Any]:
    """Atomically import newline-separated tokens to one provider.

    Existing secrets and duplicate pasted lines are skipped without exposure.
    Validation is all-or-nothing; no partial import on a malformed line.
    """
    provider = _check_provider(provider_id)
    if not isinstance(lines, str) or len(lines) > 65_000:
        raise QuestionBankError("QUESTIONBANK_INVALID_BATCH")
    requested = [line.strip() for line in lines.splitlines() if line.strip()]
    if not requested or len(requested) > MAX_TOKENS:
        raise QuestionBankError("QUESTIONBANK_INVALID_BATCH")
    # Validate before opening or modifying the encrypted vault.
    unique: list[str] = []
    seen: set[str] = set()
    for raw in requested:
        secret = _validate_provider_token(provider, raw)
        if secret not in seen:
            seen.add(secret)
            unique.append(secret)
    with LOCK:
        data = _read()
        current = [item for item in data["tokens"] if item["provider_id"] == provider]
        already = {item["token"] for item in current}
        incoming = [secret for secret in unique if secret not in already]
        if len(current) + len(incoming) > MAX_TOKENS:
            raise QuestionBankError("QUESTIONBANK_TOKEN_LIMIT")
        used_labels = {row["label"] for row in current}
        position = 1
        for secret in incoming:
            while f"Token {position:03d}" in used_labels:
                position += 1
            label = f"Token {position:03d}"
            used_labels.add(label)
            position += 1
            new_id = uuid.uuid4().hex
            data["tokens"].append({"id": new_id, "provider_id": provider,
                                   "label": label, "token": secret})
            if not data["active"].get(provider):
                data["active"][provider] = new_id
        modes = data.setdefault("rotation_modes", {})
        if incoming and len(current) + len(incoming) > 1 and provider not in modes:
            modes[provider] = "round_robin"
        if incoming:
            _write(data)
        result = _public(data)
        result.update(added=len(incoming), skipped=len(requested) - len(incoming))
        return result


def set_rotation(provider_id: Any, mode: Any) -> dict[str, Any]:
    provider = _check_provider(provider_id)
    if mode not in ("fixed", "round_robin"):
        raise QuestionBankError("QUESTIONBANK_INVALID_ROTATION")
    with LOCK:
        data = _read()
        data.setdefault("rotation_modes", {})[provider] = mode
        data.setdefault("cursors", {})[provider] = 0
        _write(data)
        return _public(data)


def check_token(token_id: Any, include_quota: bool = False) -> dict[str, Any]:
    """User-triggered single credential check, optionally reading paid balance.

    Secrets stay within Python; network I/O occurs outside the encrypted-vault
    lock. Store only status and quota metadata, never raw upstream responses.
    """
    if (not isinstance(token_id, str) or len(token_id) != 32
            or type(include_quota) is not bool):
        raise QuestionBankError("QUESTIONBANK_INVALID_TOKEN_ID")
    with LOCK:
        data = _read()
        token = next((row for row in data["tokens"] if row["id"] == token_id), None)
        if token is None:
            raise QuestionBankError("QUESTIONBANK_TOKEN_NOT_FOUND")
        provider = PROVIDERS[token["provider_id"]]
        checker = provider.get("check")
        if checker is None:
            raise QuestionBankError("QUESTIONBANK_CHECK_UNSUPPORTED")
        secret = token["token"]
    report = checker(secret, include_quota=include_quota)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    validity = report.get("validity")
    if validity not in ("valid", "invalid", "unknown"):
        validity = "unknown"
    remaining = report.get("remaining")
    if type(remaining) is not int or remaining < 0:
        remaining = None
    with LOCK:
        data = _read()
        token = next((row for row in data["tokens"] if row["id"] == token_id), None)
        if token is None:
            raise QuestionBankError("QUESTIONBANK_TOKEN_NOT_FOUND")
        token["validity"] = validity
        token["check_reason"] = str(report.get("reason", ""))[:50]
        token["checked_at"] = now
        if report.get("quota_checked") is True and remaining is not None:
            token["remaining"] = remaining
            token["balance_at"] = now
        _write(data)
        return _public(data)


def select_token(token_id: Any) -> dict[str, Any]:
    if not isinstance(token_id, str) or len(token_id) != 32:
        raise QuestionBankError("QUESTIONBANK_INVALID_TOKEN_ID")
    with LOCK:
        data = _read()
        item = next((row for row in data["tokens"] if row["id"] == token_id), None)
        if item is None:
            raise QuestionBankError("QUESTIONBANK_TOKEN_NOT_FOUND")
        data["active"][item["provider_id"]] = token_id
        _write(data)
        return _public(data)


def remove_token(token_id: Any) -> dict[str, Any]:
    if not isinstance(token_id, str) or len(token_id) != 32:
        raise QuestionBankError("QUESTIONBANK_INVALID_TOKEN_ID")
    with LOCK:
        data = _read()
        item = next((row for row in data["tokens"] if row["id"] == token_id), None)
        if item is None:
            raise QuestionBankError("QUESTIONBANK_TOKEN_NOT_FOUND")
        data["tokens"] = [row for row in data["tokens"] if row["id"] != token_id]
        provider = item["provider_id"]
        if data["active"].get(provider) == token_id:
            alternate = next((row["id"] for row in data["tokens"]
                              if row["provider_id"] == provider), None)
            if alternate:
                data["active"][provider] = alternate
            else:
                data["active"].pop(provider, None)
        _write(data)
        return _public(data)


def _question_field(value: Any, *, maximum: int, required: bool = False) -> str:
    try:
        return yanxi._field(value, maximum=maximum, required=required)
    except QuestionBankError as exc:
        raise QuestionBankError("QUESTIONBANK_INVALID_QUESTION") from exc


def _normalize_question(question: Any) -> tuple[str, str, str]:
    if not isinstance(question, dict):
        raise QuestionBankError("QUESTIONBANK_INVALID_QUESTION")
    title = _question_field(question.get("title"), maximum=4000, required=True)
    qtype = _question_field(question.get("question_type", ""), maximum=40)
    raw_options = question.get("options", [])
    if isinstance(raw_options, str):
        options = _question_field(raw_options, maximum=4000)
    elif isinstance(raw_options, list) and len(raw_options) <= 20:
        parts = []
        for row in raw_options:
            if not isinstance(row, dict):
                raise QuestionBankError("QUESTIONBANK_INVALID_QUESTION")
            key = _question_field(row.get("key", ""), maximum=10)
            text = _question_field(row.get("text"), maximum=500, required=True)
            parts.append((key + ". " if key else "") + text)
        options = "\n".join(parts)
        if len(options) > 4000:
            raise QuestionBankError("QUESTIONBANK_INVALID_QUESTION")
    else:
        raise QuestionBankError("QUESTIONBANK_INVALID_QUESTION")
    return title, options, qtype


def query_question(provider_id: Any, question: Any, token_id: Any = None) -> dict[str, Any]:
    provider = _check_provider(provider_id)
    # Validate before accessing any token or sending a paid request.
    title, options, qtype = _normalize_question(question)
    if token_id is not None and (not isinstance(token_id, str) or len(token_id) != 32):
        raise QuestionBankError("QUESTIONBANK_INVALID_TOKEN_ID")
    with LOCK:
        data = _read()
        available = [row for row in data["tokens"] if row["provider_id"] == provider]
        if token_id is None and data.get("rotation_modes", {}).get(provider) == "round_robin":
            if not available:
                raise QuestionBankError("QUESTIONBANK_TOKEN_NOT_FOUND")
            cursor = data.get("cursors", {}).get(provider, 0)
            item = available[cursor % len(available)]
            data.setdefault("cursors", {})[provider] = cursor + 1
            # Reserve the slot before leaving the lock, including for concurrent callers.
            _write(data)
        else:
            selected = token_id or data["active"].get(provider)
            item = next((row for row in available if row["id"] == selected), None)
            if item is None:
                raise QuestionBankError("QUESTIONBANK_TOKEN_NOT_FOUND")
        # Copy the token while locked, but never hold the lock over remote I/O.
        secret = item["token"]
        selected_id = item["id"]
        selected_label = item["label"]
    adapter: Callable[..., dict[str, Any]] = PROVIDERS[provider]["lookup"]
    result = adapter(title, options, qtype, token=secret)
    # Reuse real balance data from normal lookups; no second paid probe needed.
    balance = result.get("remaining")
    if type(balance) is int and balance >= 0:
        with LOCK:
            data = _read()
            record = next((row for row in data["tokens"] if row["id"] == selected_id), None)
            if record is not None:
                record["remaining"] = balance
                record["balance_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                _write(data)
    return {
        **result,
        "provider_id": provider,
        "provider_name": PROVIDERS[provider]["name"],
        "token_id": selected_id,
        "token_label": selected_label,
        "verified": False,
    }
