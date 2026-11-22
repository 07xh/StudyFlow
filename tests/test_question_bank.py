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
