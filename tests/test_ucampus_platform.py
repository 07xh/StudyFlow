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



def test_ai_home_course_envelope_and_duplicate_resources():
    payload = {"code": 1, "value": {"courseList": [
        {"classId": "100", "id": "200", "name": "大学英语", "courseResourceList": [
            {"instanceId": "301", "name": "英语听说"},
            {"instanceId": "301", "name": "重复"},
            {"instanceId": "302", "name": "英语读写"}]}]}}
    courses = parse_catalog(payload)
    assert [(course.course_id, course.title) for course in courses] == [
        ("301", "英语听说"), ("302", "英语读写")]
    assert all(course.progress_percent is None for course in courses)
    with pytest.raises(UCampusCatalogError):
        parse_catalog({**payload, "code": -1})


def test_bookshelf_parse_skips_expired_and_deduplicates():
    payload = {"success": True, "value": {"groups": {
        "CLASS_COURSE": [{"instanceId": "1", "name": "班级课程"}],
        "PERSONAL": [{"instanceId": "1", "name": "重复"}, {"instanceId": "2", "name": "个人课程"}],
        "EXPIRED": [{"instanceId": "3", "name": "过期"}]
    }}}
    assert [(c.course_id, c.title) for c in parse_catalog(payload)] == [
        ("1", "班级课程"), ("2", "个人课程")]


def test_ai_home_empty_falls_back_to_upstream_bookshelf(monkeypatch):
    cfg = UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=secret"})
    assert cfg.catalog_url.endswith("/getHomeCourseListByStudent")
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.credentials.load", lambda: cfg)
    calls = []
    class Response:
        status_code = 200
        is_redirect = False
        headers = {"content-type": "application/json"}
        content = b"{}"
        def __init__(self, payload):
            self.payload = payload
        def json(self):
            return self.payload
    def get(url, **kwargs):
        calls.append((url, kwargs))
        if len(calls) == 1:
            return Response({"code": 1, "value": {"courseList": []}})
        return Response({"code": 1, "value": {"groups": {
            "CLASS_COURSE": [{"instanceId": "123", "name": "大学英语"}]}}})
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.requests.get", get)
    courses = UCampusAdapter().list_courses()
    assert [c.title for c in courses] == ["大学英语"]
    assert len(calls) == 2
    assert all(call[1]["allow_redirects"] is False for call in calls)
    assert all(call[1]["headers"]["Cookie"] == "sid=secret" for call in calls)


def test_classic_requires_explicit_endpoint():
    with pytest.raises(ValueError):
        UCampusConfig.from_dict({"variant": "classic", "cookie": "sid=secret"})


def test_optional_content_auth_is_bounded_and_never_required_for_catalog():
    cfg = UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=local",
                                    "annotator_token": "user-provided-token", "school_id": "8320"})
    assert cfg.annotator_token == "user-provided-token"
    assert cfg.school_id == "8320"
    assert UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=local"}).school_id == ""
    for extra in ({"annotator_token": "bad\nheader"}, {"school_id": "../school"},
                  {"annotator_token": "x" * 4097}, {"school_id": "832O"}):
        with pytest.raises(ValueError):
            UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=local", **extra})


def test_empty_catalog_is_not_reported_as_authenticated(monkeypatch):
    config = UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=secret"})
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.credentials.load", lambda: config)
    monkeypatch.setattr(UCampusAdapter, "list_courses", lambda self: [])
    result = UCampusAdapter().connection_info()
    assert result.platform == Platform.UCAMPUS
    assert result.connected is False
    assert "空列表" in result.message


def test_connection_status_preserves_safe_known_catalog_failure(monkeypatch):
    config = UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=secret"})
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.credentials.load", lambda: config)
    def expired(self):
        raise UCampusCatalogError("UCAMPUS_SESSION_EXPIRED")
    monkeypatch.setattr(UCampusAdapter, "list_courses", expired)
    status = UCampusAdapter().connection_info()
    assert not status.connected and "会话已失效" in status.message


def test_ai_catalog_uses_provider_auth_headers_after_sso_login(monkeypatch):
    import base64
    import json
    claim = base64.urlsafe_b64encode(json.dumps({"openId": "my-user-id"}).encode()).decode().rstrip("=")
    jwt = f"header.{claim}.signature"
    config = UCampusConfig.from_dict({"variant": "ai", "cookie": "jwt=" + jwt,
        "school_id": "8320", "annotator_token": "my-content-token"})
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.credentials.load", lambda: config)
    observed = []
    class Response:
        status_code = 200
        is_redirect = False
        content = b"{}"
        headers = {"content-type": "application/json"}
        def json(self):
            return {"code": 1, "value": {"courseList": [
                {"name": "English", "courseResourceList": [
                    {"instanceId": "course-v2:real+course+1", "name": "English II"}
                ]}
            ]}}
    def get(url, **kwargs):
        observed.append((url, kwargs))
        return Response()
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.requests.get", get)
    courses = UCampusAdapter().list_courses()
    assert len(courses) == 1 and courses[0].course_id == "course-v2:real+course+1"
    assert len(observed) == 1
    url, options = observed[0]
    headers = options["headers"]
    assert url.startswith("https://uai.unipus.cn/")
    assert options["allow_redirects"] is False
    assert headers["Cookie"] == "jwt=" + jwt
    assert headers["Authorization"] == jwt
    assert headers["u-openid"] == "my-user-id"
    assert headers["x-csrftoken"] == "my-user-id"
    assert headers["u-app-id"] == "39"
    assert headers["u-platform"] == "2"
    assert headers["u-school"] == "8320"
    assert headers["x-annotator-auth-token"] == "my-content-token"


def test_opaque_cookie_can_still_query_catalog_without_invented_openid(monkeypatch):
    config = UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=opaque-session"})
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.credentials.load", lambda: config)
    observed = []
    class Response:
        status_code = 200
        is_redirect = False
        content = b"{}"
        headers = {"content-type": "application/json"}
        def json(self):
            return {"code": 1, "value": {"courseList": [
                {"name": "English", "courseResourceList": [
                    {"instanceId": "course-v2:abc+eng+1", "name": "English"}
                ]}
            ]}}
    def get(url, **kwargs):
        observed.append(kwargs)
        return Response()
    monkeypatch.setattr("studyflow.platforms.ucampus.adapter.requests.get", get)
    assert len(UCampusAdapter().list_courses()) == 1
    assert "Authorization" not in observed[0]["headers"]
    assert "u-openid" not in observed[0]["headers"]


def test_ucampus_local_jwt_expiration_hint_is_not_authentication(monkeypatch):
    import base64
    import json
    import time
    from studyflow.platforms.ucampus import credentials

    def config(exp):
        claims = {"exp": exp}
        encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
        return UCampusConfig.from_dict({
            "variant": "ai", "cookie": f"jwt=header.{encoded}.signature"
        })

    now = int(time.time())
    assert credentials._jwt_lifetime_state(config(1)) == "expired"
    assert credentials._jwt_lifetime_state(config(now + 120)) == "expiring"
    assert credentials._jwt_lifetime_state(config(now + 3600)) == "not_expired"
    assert credentials._jwt_lifetime_state(
        UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=opaque"})
    ) == "unknown"
    assert credentials._jwt_lifetime_state(None) == "unknown"

    stored = config(1)
    monkeypatch.setattr(credentials, "load", lambda: stored)
    result = credentials.status()
    assert result == {"configured": True, "variant": "ai", "jwt_lifetime": "expired"}
    assert "header." not in repr(result)
    assert "jwt=" not in repr(result)
