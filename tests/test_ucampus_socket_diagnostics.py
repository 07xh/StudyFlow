"""U校园 legacy socket diagnostic stays read-only and does not leak secrets."""
from __future__ import annotations

from studyflow.services import ucampus_socket_diagnostics as service


def test_socket_diagnosis_only_authenticates_no_learning_event(monkeypatch):
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    from studyflow.platforms.ucampus import course_progress
    config = UCampusConfig.from_dict({
        "variant": "ai", "cookie": "jwt=header.payload.signature",
        "annotator_token": "secret-local-user-token"})
    monkeypatch.setattr(service.ucampus_credentials, "load", lambda: config)
    monkeypatch.setattr(service, "_jwt_open_id", lambda _: "real-open-id")
    calls = []
    class FakeSocket:
        def __init__(self, session):
            assert session.open_id == "real-open-id"
            assert session.annotator_token == "secret-local-user-token"
        def __enter__(self):
            calls.append("connect")
            return self
        def __exit__(self, *args):
            calls.append("close")
    monkeypatch.setattr(service, "UCampusLegacySocket", FakeSocket)
    result = service.diagnose_legacy_socket()
    assert result["ok"] is True
    assert result["handshake"] == "namespace_joined"
    assert result["learning_events_sent"] == 0
    assert result["progress_verified"] is False
    assert result["ai5_compatible"] is None
    assert calls == ["connect", "close"]
    assert "secret-local-user-token" not in str(result)


def test_socket_diagnosis_requires_owned_session_and_token(monkeypatch):
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    monkeypatch.setattr(service.ucampus_credentials, "load", lambda: None)
    assert service.diagnose_legacy_socket()["error"] == "UCAMPUS_SESSION_MISSING"
    config = UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=user"})
    monkeypatch.setattr(service.ucampus_credentials, "load", lambda: config)
    assert service.diagnose_legacy_socket()["error"] == "UCAMPUS_SOCKET_TOKEN_REQUIRED"


def test_socket_diagnostic_error_does_not_leak_sensitive_values(monkeypatch):
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    config = UCampusConfig.from_dict({
        "variant": "ai", "cookie": "sid=own", "annotator_token": "SUPER_SECRET"})
    monkeypatch.setattr(service.ucampus_credentials, "load", lambda: config)
    monkeypatch.setattr(service, "_jwt_open_id", lambda _: "openid")
    class BrokenSocket:
        def __init__(self, session): pass
        def __enter__(self):
            raise ConnectionError("SUPER_SECRET connection details")
    monkeypatch.setattr(service, "UCampusLegacySocket", BrokenSocket)
    result = service.diagnose_legacy_socket()
    assert result["error"] == "UCAMPUS_SOCKET_TRANSPORT_UNKNOWN"
    assert "SUPER_SECRET" not in str(result)


