"""Offline U校园AI SSO contract tests; no account or network is used."""
from __future__ import annotations

import pytest

from studyflow.platforms.ucampus import sso_login


def _response(data, status=200):
    class Response:
        status_code = status
        is_redirect = False
        headers = {"content-type": "application/json; charset=utf-8"}
        content = b"{}"
        def json(self):
            return data
    return Response()


def test_aes_cbc_envelope_matches_public_provider_sdk_vector():
    assert sso_login.encrypt_field("testuser") == "0BEE28AAD749A902C115ABE749B97F61"
    assert sso_login.encrypt_field("another") != sso_login.encrypt_field("testuser")


def test_success_only_returns_a_provider_jwt_session(monkeypatch):
    received = []
    def post(url, **kwargs):
        received.append((url, kwargs))
        return _response({"code": "0", "rs": {
            "jwt": "header.eyJvcGVuSWQiOiJ0ZXN0In0.signature",
            "rt": "refresh-token-must-not-be-stored",
        }})
    monkeypatch.setattr(sso_login.requests, "post", post)
    config = sso_login.authenticate(" student ", "mypassword")
    assert config.variant == "ai"
    assert config.cookie.startswith("jwt=header.")
    assert config.authorization == ""
    assert "mypassword" not in repr(config)
    assert "refresh-token-must-not-be-stored" not in repr(config)
    assert len(received) == 1
    url, params = received[0]
    assert url == "https://sso.unipus.cn/sso/0.1/sso/cip/login"
    assert params["allow_redirects"] is False
    assert params["timeout"] == (5, 15)
    assert params["headers"]["Origin"] == "https://uai.unipus.cn"
    assert params["json"]["username"] == sso_login.encrypt_field("student")
    assert params["json"]["password"] == sso_login.encrypt_field("mypassword")
    assert "mypassword" not in str(params["json"])


@pytest.mark.parametrize("code,expected", [
    (1502, "UCAMPUS_LOGIN_VERIFICATION_REQUIRED"),
    ("1506", "UCAMPUS_LOGIN_VERIFICATION_REQUIRED"),
    (1507, "UCAMPUS_LOGIN_RATE_LIMITED"),
    (1001, "UCAMPUS_LOGIN_REJECTED"),
])
def test_provider_login_errors_have_fixed_codes(monkeypatch, code, expected):
    monkeypatch.setattr(sso_login.requests, "post",
                        lambda *args, **kwargs: _response({"code": code, "msg": "sensitive data"}))
    with pytest.raises(sso_login.UCampusLoginError) as error:
        sso_login.authenticate("student", "secret")
    assert str(error.value) == expected
    assert "sensitive" not in str(error.value)


def test_bad_input_is_rejected_before_any_network(monkeypatch):
    monkeypatch.setattr(sso_login.requests, "post",
                        lambda *args, **kwargs: pytest.fail("must not use network"))
    for user, password in [("", "valid"), ("user", ""), ("user\r\nHeader: evil", "valid"),
                           ("user", "secret\x00injected")]:
        with pytest.raises(sso_login.UCampusLoginError, match="INVALID_UCAMPUS_LOGIN"):
            sso_login.authenticate(user, password)


def test_success_without_valid_jwt_does_not_create_a_session(monkeypatch):
    for body in ({"code": 0, "rs": {}}, {"code": 0, "rs": {"jwt": "not-a-jwt"}},
                 {"code": 0, "rs": {"jwt": "x.y.z\r\nHeader:bad"}}):
        monkeypatch.setattr(sso_login.requests, "post",
                            lambda *args, **kwargs: _response(body))
        with pytest.raises(sso_login.UCampusLoginError, match="UCAMPUS_LOGIN_FORMAT_UNVERIFIED"):
            sso_login.authenticate("student", "password")


def test_profile_reads_school_from_fixed_first_party_get(monkeypatch):
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    original = UCampusConfig.from_dict({"variant": "ai",
        "cookie": "jwt=header.eyJvcGVuSWQiOiJ1MSJ9.signature"})
    sent = []
    def get(url, **kwargs):
        sent.append((url, kwargs))
        return _response({"code": 1, "value": {"userInfo": {"school": "8320"}}})
    monkeypatch.setattr(sso_login.requests, "get", get)
    enriched = sso_login.enrich_school_from_account(original)
    assert original.school_id == ""
    assert enriched.school_id == "8320"
    assert enriched.cookie == original.cookie
    assert len(sent) == 1
    url, options = sent[0]
    assert url == "https://uai.unipus.cn/api/account/user/info"
    assert options["allow_redirects"] is False
    assert options["headers"]["Cookie"] == original.cookie
    assert options["headers"]["Authorization"] == original.cookie[4:]
    assert options["timeout"] == (5, 10)


@pytest.mark.parametrize("body", [
    {"code": 1, "value": {"userInfo": {"school": "unknown"}}},
    {"code": 1, "value": {"userInfo": {"school": "../secret"}}},
    {"code": 1, "value": {"userInfo": {"school": True}}},
    {"code": 401, "value": {"userInfo": {"school": "8320"}}},
    {"code": 1, "value": {"userInfo": {}}},
    {"code": 1, "value": None},
])
def test_bad_profile_never_overwrites_session(monkeypatch, body):
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    original = UCampusConfig.from_dict({"variant": "ai",
        "cookie": "jwt=header.eyJvcGVuSWQiOiJ1MSJ9.signature"})
    monkeypatch.setattr(sso_login.requests, "get", lambda *a, **k: _response(body))
    assert sso_login.enrich_school_from_account(original) == original


def test_profile_network_failure_does_not_block_login(monkeypatch):
    import requests
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    original = UCampusConfig.from_dict({"variant": "ai",
        "cookie": "jwt=header.eyJvcGVuSWQiOiJ1MSJ9.signature"})
    def unavailable(*args, **kwargs):
        raise requests.exceptions.Timeout("contains private details")
    monkeypatch.setattr(sso_login.requests, "get", unavailable)
    assert sso_login.enrich_school_from_account(original) == original
