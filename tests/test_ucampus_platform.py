"""Contract checks do not pretend to authenticate against U校园."""
import pytest

from studyflow.core.models import Platform
from studyflow.platforms.ucampus.adapter import UCampusAdapter, UCampusCatalogError, parse_catalog
from studyflow.platforms.ucampus.credentials import UCampusConfig


def test_disconnected_without_verified_login(monkeypatch):
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.credentials.load", lambda: None)
    status = UCampusAdapter().connection_info()
    assert status.platform == Platform.UCAMPUS and not status.connected
    with pytest.raises(UCampusCatalogError, match="UCAMPUS_SESSION_MISSING"):
        UCampusAdapter().list_courses()


def test_credential_host_allowlist_and_cookie_validation():
    data = {"variant": "ai", "catalog_url": "https://ucloud.unipus.cn/api/catalog", "cookie": "sid=secret"}
    assert UCampusConfig.from_dict(data).variant == "ai"
    for url in ("http://ucloud.unipus.cn/api/catalog",
                "https://ucloud.unipus.cn.evil.invalid/api/catalog",
                "https://u.unipus.cn/api/catalog",
                "https://ucloud.unipus.cn:444/api/catalog",
                "https://ucloud.unipus.cn/"):
        with pytest.raises(ValueError):
            UCampusConfig.from_dict({**data, "catalog_url": url})
    with pytest.raises(ValueError):
        UCampusConfig.from_dict({**data, "cookie": "sid=secret\r\nExtra: secret"})


def test_catalog_only_contains_real_server_course_fields():
    result = parse_catalog({"data": {"courses": [{"courseId": 12, "courseName": "大学外语"},
                                                   {"courseId": 12, "courseName": "重复"},
                                                   {"name": "缺少课程ID"}]}})
    assert len(result) == 1
    assert result[0].platform == Platform.UCAMPUS
    assert result[0].title == "大学外语"
    assert result[0].progress_percent is None
    with pytest.raises(UCampusCatalogError):
        parse_catalog({"data": {"other": "not a catalog"}})
    with pytest.raises(UCampusCatalogError):
        parse_catalog({"success": False, "data": []})


def test_single_get_no_redirect(monkeypatch):
    config = UCampusConfig.from_dict({"variant": "ai", "catalog_url": "https://ucloud.unipus.cn/api/catalog", "cookie": "sid=secret"})
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.credentials.load", lambda: config)
    captured = []
    class Response:
        status_code = 200
        is_redirect = False
        content = b'{"data":[{"id":"8","name":"English"}]}'
        headers = {"content-type": "application/json"}
        def json(self): return {"data": [{"id": "8", "name": "English"}]}
    def get(url, **kwargs):
        captured.append((url, kwargs))
        return Response()
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.requests.get", get)
    assert UCampusAdapter().list_courses()[0].title == "English"
    assert captured[0][1]["allow_redirects"] is False
    assert len(captured) == 1
