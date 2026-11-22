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
from pathlib import Path
from typing import Any, Callable

from studyflow.services import yanxi_question_bank as yanxi

ROOT = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".studyflow") / "StudyFlow" / "question-bank"
STORE_PATH = ROOT / "providers.dpapi"
MAX_TOKENS = 20
LOCK = threading.RLock()
QuestionBankError = yanxi.QuestionBankError

# Extend this registry with a provider adapter; UI and bridge remain unchanged.
PROVIDERS: dict[str, dict[str, Any]] = {
    "yanxi": {
        "name": "言溪题库",
        "lookup": yanxi.search,
        "description": "Token 搜题接口",
    },
}


def _state() -> dict[str, Any]:
    return {"version": 1, "tokens": [], "active": {}}


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
        if not raw or len(raw) > 50_000:
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
            yanxi._valid_token(item.get("token"))
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
        "providers": [{"id": key, "name": item["name"], "description": item["description"]}
                      for key, item in PROVIDERS.items()],
        "tokens": [{"id": item["id"], "provider_id": item["provider_id"],
                    "label": item["label"],
                    "active": data["active"].get(item["provider_id"]) == item["id"]}
                   for item in data["tokens"]],
    }


def list_tokens() -> dict[str, Any]:
    with LOCK:
        return _public(_read())


def add_token(provider_id: Any, label: Any, token: Any) -> dict[str, Any]:
    provider = _check_provider(provider_id)
    if not isinstance(label, str) or not 1 <= len(label.strip()) <= 50:
        raise QuestionBankError("QUESTIONBANK_INVALID_LABEL")
    secret = yanxi._valid_token(token)
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


def _normalize_question(question: Any) -> tuple[str, str, str]:
    if not isinstance(question, dict):
        raise QuestionBankError("QUESTIONBANK_INVALID_QUESTION")
    title = yanxi._field(question.get("title"), maximum=4000, required=True)
    qtype = yanxi._field(question.get("question_type", ""), maximum=40)
    raw_options = question.get("options", [])
    if isinstance(raw_options, str):
        options = yanxi._field(raw_options, maximum=4000)
    elif isinstance(raw_options, list) and len(raw_options) <= 20:
        parts = []
        for row in raw_options:
            if not isinstance(row, dict):
                raise QuestionBankError("QUESTIONBANK_INVALID_QUESTION")
            key = yanxi._field(row.get("key", ""), maximum=10)
            text = yanxi._field(row.get("text"), maximum=500, required=True)
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
        selected = token_id or data["active"].get(provider)
        item = next((row for row in data["tokens"]
                     if row["id"] == selected and row["provider_id"] == provider), None)
        if item is None:
            raise QuestionBankError("QUESTIONBANK_TOKEN_NOT_FOUND")
        # Copy the token while locked, but never hold the lock over remote I/O.
        secret = item["token"]
        selected_id = item["id"]
        selected_label = item["label"]
    adapter: Callable[..., dict[str, Any]] = PROVIDERS[provider]["lookup"]
    result = adapter(title, options, qtype, token=secret)
    return {
        **result,
        "provider_id": provider,
        "provider_name": PROVIDERS[provider]["name"],
        "token_id": selected_id,
        "token_label": selected_label,
        "verified": False,
    }
