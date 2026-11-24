from pathlib import Path

from studyflow.services import bridge


def test_cookie_import_dispatch_returns_sanitized_original_result(monkeypatch):
    monkeypatch.setattr(
        bridge, "import_cookie",
        lambda content, mode: {"imported": True, "message": "Cookie 文件导入成功；服务器已确认登录。"},
    )
    result = bridge.dispatch({
        "id": "cookie-1", "version": 1, "operation": "zhidao.cookie.import",
        "mode": "file", "content": "[{\"name\":\"session\",\"value\":\"local-test\"}]",
    })
    assert result["ok"] is True
    assert result["data"]["imported"] is True
    assert "local-test" not in str(result)


def test_cookie_import_dispatch_redacts_runtime_exception(monkeypatch):
    def fail(_content, _mode):
        raise RuntimeError("SENSITIVE_COOKIE_VALUE")
    monkeypatch.setattr(bridge, "import_cookie", fail)
    result = bridge.dispatch({
        "id": "cookie-2", "version": 1, "operation": "zhidao.cookie.import",
        "mode": "text", "content": "Cookie: session=local-test",
    })
    assert result == {"id": "cookie-2", "ok": False, "error": "COOKIE_IMPORT_FAILED"}
    assert "SENSITIVE_COOKIE_VALUE" not in str(result)


def test_cookie_import_dispatch_rejects_invalid_input(monkeypatch):
    def invalid(_content, _mode):
        raise ValueError("raw input must not be returned")
    monkeypatch.setattr(bridge, "import_cookie", invalid)
    result = bridge.dispatch({
        "id": "cookie-3", "version": 1, "operation": "zhidao.cookie.import",
        "mode": "unknown", "content": "invalid",
    })
    assert result == {"id": "cookie-3", "ok": False, "error": "INVALID_COOKIE_IMPORT"}


def test_cookie_import_wrapper_reuses_original_modules():
    root = Path(__file__).resolve().parents[1] / "legacy" / "zhidao"
    wrapper = (root / "CookieImportBridge.ps1").read_text(encoding="utf-8-sig")
    assert ". (Join-Path $PSScriptRoot 'SessionState.ps1')" in wrapper
    assert ". (Join-Path $PSScriptRoot 'CookieImport.ps1')" in wrapper
    assert "Read-ZhidaoCookieImport" in wrapper
    assert "Convert-ZhidaoCookieText" in wrapper
    assert "Begin-ZhidaoCookieImport" in wrapper
    assert "Complete-ZhidaoCookieImport" in wrapper


def test_native_cookie_validation_scopes_and_rejects_unsafe_input():
    import pytest
    from studyflow.platforms.zhidao.cookie_import import parse_cookie
    assert parse_cookie("Cookie: session=local-test", "text") == [
        {"name": "session", "value": "local-test", "domain": ".zhihuishu.com", "path": "/"}]
    assert parse_cookie('[{"name":"session","value":"local-test"}]', "file")[0]["domain"] == ".zhihuishu.com"
    for value in ('[{"name":"x","value":"v","domain":"example.org"}]', "x=1;x=2", "x=1\ny=2"):
        with pytest.raises(ValueError):
            parse_cookie(value, "text")


def test_cookie_auth_does_not_replace_prior_session_until_verified(monkeypatch, tmp_path):
    import sys
    from types import ModuleType, SimpleNamespace
    from studyflow.platforms.zhidao import cookie_import
    directory = tmp_path / ".zhs"
    directory.mkdir()
    destination = directory / "cookies.json"
    destination.write_bytes(b"prior-session")
    status = SimpleNamespace(OK="ok", EXPIRED="expired", UNAVAILABLE="unavailable")
    candidate = SimpleNamespace(cookies=None, close=lambda: None)
    for name in ("loguru", "zhs", "zhs.api", "zhs.api.session_auth", "zhs.utils", "zhs.utils.cookie"):
        monkeypatch.setitem(sys.modules, name, ModuleType(name))
    sys.modules["loguru"].logger = SimpleNamespace(remove=lambda: None)
    auth = sys.modules["zhs.api.session_auth"]
    auth.SessionStatus = status
    sys.modules["zhs.utils.cookie"].list_to_cookies = lambda rows: rows
    monkeypatch.setattr(cookie_import, "initialize_login", lambda home: (None, candidate, directory))
    monkeypatch.setattr(cookie_import, "save_cookies_atomic", lambda path, cookies: path.write_bytes(b"verified-session"))
    for outcome in (status.EXPIRED, status.UNAVAILABLE):
        auth.verify_session = lambda session: outcome
        result = cookie_import.import_cookie("session=local-test", "text")
        assert not result["imported"] and destination.read_bytes() == b"prior-session"
        assert "local-test" not in str(result)
    auth.verify_session = lambda session: status.OK
    assert cookie_import.import_cookie("session=local-test", "text")["imported"]
    assert destination.read_bytes() == b"verified-session"
