"""Offline contract tests for optional Yanxi integration. No real token or network."""
import json
import urllib.parse

import pytest
from studyflow.services import bridge, question_bank as bank
from studyflow.services import yanxi_question_bank as yanxi

TOKEN = "a" * 32


def test_rc57_legacy_token_only_reads_and_migrates_into_shared_vault(tmp_path, monkeypatch):
    old = tmp_path / "old" / "yanxi.dpapi"
    old.parent.mkdir(parents=True)
    monkeypatch.setattr(yanxi, "STORE_PATH", old)
    monkeypatch.setattr(bank, "STORE_PATH", tmp_path / "new" / "providers.dpapi")
    monkeypatch.setattr(yanxi, "_dpapi", lambda value, protect:
                        bytes(part ^ 0x5A for part in value))
    old.write_bytes(yanxi._dpapi(TOKEN.encode("ascii"), protect=True))
    assert TOKEN.encode() not in old.read_bytes()
    assert yanxi._load_legacy_token() == TOKEN
    migrated = bank.list_tokens()
    assert len(migrated["tokens"]) == 1
    assert migrated["tokens"][0]["active"]
    assert bank.STORE_PATH.exists() and not old.exists()
    assert TOKEN not in repr(migrated)

def test_invalid_token_does_not_touch_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(yanxi, "STORE_PATH", tmp_path / "token.dpapi")
    with pytest.raises(yanxi.QuestionBankError, match="YANXI_INVALID_TOKEN"):
        yanxi._valid_token("token with space")
    assert not yanxi.STORE_PATH.exists()


def test_query_uses_own_token_and_only_requested_fields(monkeypatch):
    seen = []
    class FakeReply:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def read(self, _maximum):
            return json.dumps({"code": 1, "data": {
                "answer": "B", "times": 48}}, ensure_ascii=False).encode()
    class FakeOpener:
        def open(self, request, timeout):
            seen.append((request.full_url, timeout))
            return FakeReply()
    monkeypatch.setattr(yanxi.urllib.request, "build_opener", lambda *args: FakeOpener())
    result = yanxi.search("测试题干", "A. 错\\nB. 对", "单选", token=TOKEN)
    assert result["found"] is True and result["answer"] == "B"
    assert result["remaining"] == 48
    parsed = urllib.parse.urlparse(seen[0][0])
    params = urllib.parse.parse_qs(parsed.query)
    assert (parsed.scheme, parsed.netloc, parsed.path) == ("https", "tk.enncy.cn", "/query")
    assert set(params) == {"token", "title", "options", "type"}
    assert params["token"] == [TOKEN]
    assert seen[0][1] == 12
    assert TOKEN not in repr(result)


def test_api_failure_never_returns_unverified_answer_as_success():
    response = yanxi._parse_result({"code": 0, "message": "未找到题目", "data": {}})
    assert response["found"] is False
    with pytest.raises(yanxi.QuestionBankError, match="YANXI_QUOTA_EXHAUSTED"):
        yanxi._parse_result({"code": 0, "data": {"answer": "剩余次数不足"}})
    with pytest.raises(yanxi.QuestionBankError, match="YANXI_TOKEN_REJECTED"):
        yanxi._parse_result({"code": 1, "data": {"answer": "Token错误"}})
    assert yanxi._parse_result({"code": 1, "data": {"answer": "未找到答案"}})["found"] is False
    with pytest.raises(yanxi.QuestionBankError, match="YANXI_TOKEN_REJECTED"):
        yanxi._parse_result({"code": 0, "msg": "token已失效", "data": {}})


def test_token_cannot_leave_via_http_redirect():
    assert yanxi._NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://evil.example") is None


def test_shared_bridge_rejects_legacy_apis_and_never_echoes_tokens(tmp_path, monkeypatch):
    monkeypatch.setattr(yanxi, "STORE_PATH", tmp_path / "legacy.dpapi")
    monkeypatch.setattr(bank, "STORE_PATH", tmp_path / "providers.dpapi")
    monkeypatch.setattr(yanxi, "_dpapi", lambda value, protect:
                        bytes(part ^ 0x5A for part in value))
    bank.add_token("yanxi", "当前 Token", TOKEN)
    def reject(*_args, **_kwargs):
        raise yanxi.QuestionBankError("YANXI_QUOTA_EXHAUSTED")
    monkeypatch.setitem(bank.PROVIDERS["yanxi"], "lookup", reject)
    lookup = bridge.dispatch({"id": "yx1", "version": 1,
                              "operation": "questionbank.query",
                              "provider_id": "yanxi",
                              "question": {"title": "练习题"}})
    assert lookup == {"id": "yx1", "ok": False, "error": "YANXI_QUOTA_EXHAUSTED"}
    for operation in ("questionbank.yanxi.status", "questionbank.yanxi.save",
                      "questionbank.yanxi.clear", "questionbank.yanxi.query"):
        result = bridge.dispatch({"id": "yx-old", "version": 1,
                                  "operation": operation, "token": TOKEN, "title": "练习题"})
        assert result["error"] == "UNKNOWN_OPERATION"
        assert TOKEN not in repr(result)
    assert TOKEN not in repr(lookup)

def test_missing_or_bad_question_does_not_use_token(monkeypatch):
    monkeypatch.setattr(yanxi.urllib.request, "build_opener",
                        lambda *_: pytest.fail("invalid query must not contact provider"))
    with pytest.raises(yanxi.QuestionBankError, match="YANXI_INVALID_QUERY"):
        yanxi.search("", token=TOKEN)
