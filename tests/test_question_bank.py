"""Shared question-bank provider / multi-Token contract, offline only."""
import pytest

from studyflow.services import bridge
from studyflow.services import question_bank as bank
from studyflow.services import yanxi_question_bank as yanxi

ONE = "a" * 32
TWO = "b" * 32


@pytest.fixture(autouse=True)
def clean_vault(tmp_path, monkeypatch):
    monkeypatch.setattr(bank, "STORE_PATH", tmp_path / "providers.dpapi")
    monkeypatch.setattr(yanxi, "STORE_PATH", tmp_path / "legacy.dpapi")
    monkeypatch.setattr(yanxi, "_dpapi", lambda data, protect:
                        bytes(value ^ 0x5A for value in data))


def test_multiple_tokens_are_encrypted_and_list_does_not_expose_secrets():
    first = bank.add_token("yanxi", "个人账号", ONE)
    first_id = first["tokens"][0]["id"]
    assert first["tokens"] == [{"id": first_id, "provider_id": "yanxi",
                                 "label": "个人账号", "active": True}]
    second = bank.add_token("yanxi", "备用账号", TWO)
    second_id = second["tokens"][1]["id"]
    assert first_id != second_id
    assert second["tokens"][0]["active"]
    assert not second["tokens"][1]["active"]
    encrypted = bank.STORE_PATH.read_bytes()
    assert ONE.encode() not in encrypted and TWO.encode() not in encrypted
    assert ONE not in repr(bank.list_tokens())
    assert TWO not in repr(bank.list_tokens())
    chosen = bank.select_token(second_id)
    assert chosen["tokens"][1]["active"]
    assert not chosen["tokens"][0]["active"]
    assert bank.list_tokens()["tokens"][1]["active"]
    removed = bank.remove_token(second_id)
    assert len(removed["tokens"]) == 1
    assert removed["tokens"][0]["active"]


def test_question_lookup_uses_chosen_provider_token_without_auto_submission(monkeypatch):
    ids = bank.add_token("yanxi", "A", ONE)["tokens"][0]["id"]
    other = bank.add_token("yanxi", "B", TWO)["tokens"][1]["id"]
    calls = []
    monkeypatch.setitem(bank.PROVIDERS["yanxi"], "lookup",
                        lambda title, opts, typ, *, token:
                        (calls.append((title, opts, typ, token)) or
                         {"found": True, "answer": "B", "remaining": 10,
                          "status": "matched", "source": "yanxi_external_unverified"}))
    question = {"title": "示例练习题", "question_type": "单选",
                "options": [{"key": "A", "text": "错误"}, {"key": "B", "text": "正确"}]}
    first = bank.query_question("yanxi", question)
    assert calls[-1] == ("示例练习题", "A. 错误\nB. 正确", "单选", ONE)
    assert first["token_id"] == ids and first["verified"] is False
    second = bank.query_question("yanxi", question, token_id=other)
    assert calls[-1][-1] == TWO
    assert second["provider_id"] == "yanxi" and second["token_label"] == "B"
    assert "token" not in second or "token" not in second.keys()
    assert TWO not in repr(second)


def test_migration_imports_legacy_dpapi_token_once(tmp_path, monkeypatch):
    yanxi.STORE_PATH.write_bytes(yanxi._dpapi(ONE.encode(), protect=True))
    migrated = bank.list_tokens()
    assert len(migrated["tokens"]) == 1
    assert migrated["tokens"][0]["active"]
    assert bank.STORE_PATH.exists()
    assert not yanxi.STORE_PATH.exists()
    assert len(bank.list_tokens()["tokens"]) == 1


def test_reject_unknown_providers_and_malformed_questions_before_request(monkeypatch):
    bank.add_token("yanxi", "A", ONE)
    monkeypatch.setitem(bank.PROVIDERS["yanxi"], "lookup",
                        lambda *a, **k: pytest.fail("invalid input must not query"))
    with pytest.raises(bank.QuestionBankError, match="QUESTIONBANK_UNKNOWN_PROVIDER"):
        bank.query_question("unknown", {"title": "test"})
    with pytest.raises(bank.QuestionBankError):
        bank.query_question("yanxi", {"title": "", "options": []})
    with pytest.raises(bank.QuestionBankError, match="QUESTIONBANK_INVALID_QUESTION"):
        bank.query_question("yanxi", {"title": "test", "options": [{}]})
    with pytest.raises(bank.QuestionBankError, match="QUESTIONBANK_TOKEN_NOT_FOUND"):
        bank.query_question("yanxi", {"title": "test"}, token_id="e" * 32)
    with pytest.raises(bank.QuestionBankError, match="QUESTIONBANK_TOKEN_DUPLICATE"):
        bank.add_token("yanxi", "duplicate", ONE)


def test_bridge_shared_operations_are_safe_and_dont_echo_tokens(monkeypatch):
    def dispatch(op, **params):
        return bridge.dispatch({"id": "bank1", "version": 1, "operation": op, **params})
    first = dispatch("questionbank.tokens.add",
                     provider_id="yanxi",label="自用",token=ONE)
    assert first["ok"] and ONE not in str(first)
    token_id = first["data"]["tokens"][0]["id"]
    assert dispatch("questionbank.tokens.list")["data"]["tokens"][0]["id"] == token_id
    monkeypatch.setitem(bank.PROVIDERS["yanxi"], "lookup",
                        lambda *a, **k: {"found":False,"answer":"","remaining":None,
                                         "status":"not_found"})
    reply = dispatch("questionbank.query",provider_id="yanxi",
                     question={"title":"普通练习题","options":[]})
    assert reply["ok"] and reply["data"]["verified"] is False
    assert "token" not in str(reply).lower() or ONE not in str(reply)
    assert dispatch("questionbank.tokens.select",token_id=token_id)["ok"]
    assert dispatch("questionbank.tokens.remove",token_id=token_id)["ok"]
    assert dispatch("questionbank.query",provider_id="yanxi",
                    question={"title":"x"})["error"] == "QUESTIONBANK_TOKEN_NOT_FOUND"


def test_future_provider_uses_shared_vault_without_yanxi_token_pattern(monkeypatch):
    calls = []
    monkeypatch.setitem(bank.PROVIDERS, "custom", {
        "name": "测试扩展题库", "description": "测试适配器",
        "lookup": lambda title, options, kind, *, token:
            (calls.append((title, token)) or
             {"found": True, "answer": "示例说明", "remaining": None,
              "status": "matched", "source": "custom_unverified"}),
    })
    state = bank.add_token("custom", "专用令牌", "api.key:custom_123")
    assert state["tokens"][0]["provider_id"] == "custom"
    result = bank.query_question("custom", {"title": "示例", "options": []})
    assert calls == [("示例", "api.key:custom_123")]
    assert result["provider_name"] == "测试扩展题库" and result["verified"] is False
    assert "api.key:custom_123" not in repr(state) + repr(result)


def test_multiline_import_is_atomic_deduplicated_and_provider_scoped(monkeypatch):
    imported = bank.import_tokens("yanxi", "\n".join([ONE, TWO, ONE, "", TWO]))
    assert imported["added"] == 2 and imported["skipped"] == 2
    assert imported["rotation_modes"]["yanxi"] == "round_robin"
    assert len(imported["tokens"]) == 2
    assert ONE not in repr(imported) and TWO not in repr(imported)
    again = bank.import_tokens("yanxi", "\n".join([ONE, TWO]))
    assert again["added"] == 0 and again["skipped"] == 2
    assert len(again["tokens"]) == 2
    encrypted_before = bank.STORE_PATH.read_bytes()
    with pytest.raises(bank.QuestionBankError):
        bank.import_tokens("yanxi", TWO + "\n" + "invalid token with spaces")
    assert bank.STORE_PATH.read_bytes() == encrypted_before


def test_round_robin_advances_once_per_request_and_explicit_token_stays_pinned(monkeypatch):
    state = bank.import_tokens("yanxi", ONE + "\n" + TWO)
    ids = [token["id"] for token in state["tokens"]]
    used = []
    def lookup(title, opts, typ, *, token):
        used.append(token)
        if len(used) == 3:
            raise bank.QuestionBankError("YANXI_RATE_LIMITED")
        return {"found": True, "answer": "A", "remaining": None,
                "status": "matched", "source": "test"}
    monkeypatch.setitem(bank.PROVIDERS["yanxi"], "lookup", lookup)
    question = {"title": "示例题"}
    assert bank.query_question("yanxi", question)["token_id"] == ids[0]
    assert bank.query_question("yanxi", question)["token_id"] == ids[1]
    with pytest.raises(bank.QuestionBankError, match="YANXI_RATE_LIMITED"):
        bank.query_question("yanxi", question)
    assert used == [ONE, TWO, ONE], "rate limit must not retry on alternate tokens"
    assert bank.query_question("yanxi", question)["token_id"] == ids[1]
    assert bank.query_question("yanxi", question, token_id=ids[0])["token_id"] == ids[0]
    assert used[-1] == ONE
    fixed = bank.set_rotation("yanxi", "fixed")
    assert fixed["rotation_modes"]["yanxi"] == "fixed"
    assert bank.query_question("yanxi", question)["token_id"] == ids[0]


def test_bulk_import_bridge_preserves_plaintext_boundary():
    result = bridge.dispatch({"id": "bulk1", "version": 1,
        "operation": "questionbank.tokens.import", "provider_id": "yanxi",
        "lines": ONE + "\n" + TWO})
    assert result["ok"] and result["data"]["added"] == 2
    assert ONE not in repr(result) and TWO not in repr(result)
    changed = bridge.dispatch({"id": "bulk2", "version": 1,
        "operation": "questionbank.tokens.rotation", "provider_id": "yanxi",
        "mode": "fixed"})
    assert changed["ok"] and changed["data"]["rotation_modes"]["yanxi"] == "fixed"


def test_token_status_check_stores_metadata_without_exposing_secret(monkeypatch):
    from studyflow.services import yanxi_token_diagnostics as diagnostics
    selected = bank.add_token("yanxi", "主 Token", ONE)["tokens"][0]["id"]
    calls = []
    def post(path, body):
        calls.append((path, body["token"]))
        assert body["token"] == ONE
        if path == "/cloud/extract":
            return {"message": "待识别内容为空"}
        return {"data": {"times": 19}}
    monkeypatch.setattr(diagnostics, "_post", post)
    status = bank.check_token(selected)
    row = status["tokens"][0]
    assert row["validity"] == "valid"
    assert row["remaining"] is None
    assert row["checked_at"] and row["check_reason"] == "provider_recognized"
    assert len(calls) == 1
    assert ONE not in repr(status)
    detailed = bank.check_token(selected, True)
    row = detailed["tokens"][0]
    assert row["remaining"] == 19 and row["balance_at"]
    assert len(calls) == 3, "deep status should be an explicit second request"


def test_invalid_and_unrecognized_status_are_distinct_and_never_pruned(monkeypatch):
    from studyflow.services import yanxi_token_diagnostics as diagnostics
    selected = bank.add_token("yanxi", "主 Token", ONE)["tokens"][0]["id"]
    monkeypatch.setattr(diagnostics, "_post",
                        lambda *_: {"message": "Token无效或用户不存在！"})
    invalid = bank.check_token(selected, True)
    assert invalid["tokens"][0]["validity"] == "invalid"
    assert invalid["tokens"][0]["remaining"] is None
    monkeypatch.setattr(diagnostics, "_post",
                        lambda *_: {"message": "请求无法处理"})
    unknown = bank.check_token(selected)
    assert unknown["tokens"][0]["validity"] == "unknown"
    assert len(unknown["tokens"]) == 1, "diagnostics must never delete credentials"


def test_token_diagnostics_never_leave_encrypted_vault_on_ipc(monkeypatch):
    from studyflow.services import yanxi_token_diagnostics as diagnostics
    token_id = bank.add_token("yanxi", "本机凭据", ONE)["tokens"][0]["id"]
    monkeypatch.setattr(diagnostics, "_post", lambda *_: {"message": "待识别内容为空"})
    reply = bridge.dispatch({"id": "check1", "version": 1, "operation": "questionbank.tokens.check",
                             "token_id": token_id, "include_quota": False})
    assert reply["ok"]
    assert reply["data"]["tokens"][0]["validity"] == "valid"
    assert ONE not in repr(reply)


def test_normal_lookup_updates_last_known_balance_without_extra_probe(monkeypatch):
    selected = bank.add_token("yanxi", "本机凭据", ONE)["tokens"][0]["id"]
    monkeypatch.setitem(bank.PROVIDERS["yanxi"], "lookup",
                        lambda *args, **kwargs: {"found": True, "answer": "A",
                                                 "status": "matched", "remaining": 4})
    bank.query_question("yanxi", {"title": "示例"}, token_id=selected)
    row = bank.list_tokens()["tokens"][0]
    assert row["remaining"] == 4 and row["balance_at"]
