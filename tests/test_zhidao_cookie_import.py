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
