from studyflow.platforms.yuketang import credentials
from studyflow.services.bridge import dispatch


def test_marker_is_opaque_and_changes_with_session_or_scope(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    current = credentials.YuketangConfig("secret-session-A", "secret-csrf-A", "11", "22", "secret-sign")
    same = credentials.YuketangConfig("secret-session-A", "secret-csrf-A", "11", "22", "secret-sign")
    newer = credentials.YuketangConfig("secret-session-B", "secret-csrf-A", "11", "22", "secret-sign")
    other = credentials.YuketangConfig("secret-session-A", "secret-csrf-A", "99", "22", "secret-sign")
    marker = credentials.recovery_marker(current)
    assert len(marker) == 64
    assert marker == credentials.recovery_marker(same)
    assert marker != credentials.recovery_marker(newer)
    assert marker != credentials.recovery_marker(other)
    assert "secret-session-A" not in marker


def test_marker_bridge_never_exposes_credentials(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    current = credentials.YuketangConfig("secret-session-A", "secret-csrf-A", "11", "22", "secret-sign")
    monkeypatch.setattr(credentials, "load", lambda: current)
    response = dispatch({"id": "marker", "version": 1, "operation": "yuketang.session.marker"})
    assert response["ok"] is True
    assert set(response["data"]) == {"marker"}
    assert "secret" not in str(response)
