"""Offline contract tests for optional Yanxi integration. No real token or network."""
import json
import urllib.parse

import pytest
from studyflow.services import bridge
from studyflow.services import yanxi_question_bank as yanxi

TOKEN = "a" * 32


def test_local_token_is_encrypted_and_not_returned(tmp_path, monkeypatch):
    monkeypatch.setattr(yanxi, "STORE_PATH", tmp_path / "nested" / "token.dpapi")
    monkeypatch.setattr(yanxi, "_dpapi", lambda value, protect:
                        bytes(part ^ 0x5A for part in value))
    assert yanxi.configured() == {"configured": False}
    assert yanxi.save_token(TOKEN) == {"configured": True}
    raw = yanxi.STORE_PATH.read_bytes()
    assert TOKEN.encode() not in raw
    assert yanxi.configured() == {"configured": True}
    assert yanxi._load_token() == TOKEN
    assert yanxi.delete_token() == {"configured": False}


def test_invalid_token_does_not_touch_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(yanxi, "STORE_PATH", tmp_path / "token.dpapi")
    with pytest.raises(yanxi.QuestionBankError, match="YANXI_INVALID_TOKEN"):
        yanxi.save_token("token with space")
    assert not yanxi.STORE_PATH.exists()


def test_query_uses_own_token_and_only_requested_fields(monkeypatch):
    monkeypatch.setattr(yanxi, "_load_token", lambda: TOKEN)
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
    result = yanxi.search("测试题干", "A. 错\\nB. 对", "单选")
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


def test_token_cannot_leave_via_http_redirect():
    assert yanxi._NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://evil.example") is None


def test_bridge_returns_safe_errors_and_does_not_echo_token(monkeypatch):
    monkeypatch.setattr(yanxi, "save_token", lambda _: {"configured": True})
    def reject(*args):
        raise yanxi.QuestionBankError("YANXI_QUOTA_EXHAUSTED")
    monkeypatch.setattr(yanxi, "search", reject)
    saved = bridge.dispatch({"id": "yx1", "version": 1,
                             "operation": "questionbank.yanxi.save", "token": TOKEN})
    assert saved == {"id": "yx1", "ok": True, "data": {"configured": True}}
    lookup = bridge.dispatch({"id": "yx2", "version": 1,
                              "operation": "questionbank.yanxi.query", "title": "练习题"})
    assert lookup == {"id": "yx2", "ok": False, "error": "YANXI_QUOTA_EXHAUSTED"}
    assert TOKEN not in str(saved) + str(lookup)


def test_missing_or_bad_question_does_not_use_token(monkeypatch):
    monkeypatch.setattr(yanxi, "_load_token", lambda: pytest.fail("invalid query must not read token"))
    with pytest.raises(yanxi.QuestionBankError, match="YANXI_INVALID_QUERY"):
        yanxi.search("")
