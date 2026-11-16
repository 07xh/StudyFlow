"""U校园 restart-safe read-only monitoring; all tests offline."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from studyflow.platforms.ucampus import readonly_monitor as monitor
from studyflow.platforms.ucampus.course_progress import UCampusProgressError


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "checkpoint.json"
    monkeypatch.setattr(monitor, "_path", lambda: path)
    monkeypatch.setattr(monitor.credentials, "load",
                        lambda: SimpleNamespace(variant="ai", cookie="jwt=alice-secret"))
    return path


def test_opt_in_and_restart_restores_real_server_counts(store):
    assert monitor.status()["enabled"] is False
    started = monitor.configure("course-v2:eng+course+1", "U1", True)
    assert started["state"] == "pending" and started["enabled"]
    raw = store.read_text()
    assert "jwt=" not in raw and "alice-secret" not in raw
    calls = []
    class Reader:
        def list_tasks(self, course_id, unit_id):
            calls.append((course_id, unit_id))
            return [
                {"id": "video1", "completed": True},
                {"id": "audio1", "completed": False},
                {"id": "task1", "completed": None},
            ]
    restored = monitor.tick(clock=lambda: 2_000_000, reader_factory=Reader)
    assert restored["enabled"] and restored["state"] == "verified"
    assert (restored["total"], restored["passed"], restored["unknown"]) == (3, 1, 1)
    assert calls == [("course-v2:eng+course+1", "U1")]
    assert monitor.status()["checked_at"] == restored["checked_at"]
    monitor.tick(clock=lambda: 2_000_003, reader_factory=Reader)
    assert len(calls) == 1, "restart must not immediately replay a network GET"
    monitor.tick(clock=lambda: 2_000_061, reader_factory=Reader)
    assert len(calls) == 2


def test_account_switch_blocks_cross_account_resume(store, monkeypatch):
    monitor.configure("course-v2:eng+course+1", "U1", True)
    monkeypatch.setattr(monitor.credentials, "load",
                        lambda: SimpleNamespace(variant="ai", cookie="jwt=bob-secret"))
    assert monitor.status() == {
        "enabled": False, "course_id": "", "unit_id": "",
        "state": "account_changed", "checked_at": "",
        "total": 0, "passed": 0, "unknown": 0,
    }
    class ForbiddenReader:
        def list_tasks(self, *args):
            pytest.fail("must not query old account's checkpoint")
    assert monitor.tick(clock=lambda: 2_000_000,
                        reader_factory=ForbiddenReader)["enabled"] is False


def test_clear_logout_and_invalid_course_ids(store):
    monitor.configure("course-v2:real+id", "U1", True)
    assert store.exists()
    assert monitor.configure(None, None, False)["enabled"] is False
    assert not store.exists()
    with pytest.raises(monitor.UCampusMonitorError, match="INVALID_REQUEST"):
        monitor.configure("course-v2:../secret", "U1", True)
    with pytest.raises(monitor.UCampusMonitorError, match="INVALID_REQUEST"):
        monitor.configure("real", "U1", 1)


def test_server_errors_never_create_completed_status_or_leak_secrets(store):
    monitor.configure("course-v2:eng+course+1", "U1", True)
    class Reader:
        def list_tasks(self, *args):
            raise UCampusProgressError("cookie=secret-other-value")
    result = monitor.tick(clock=lambda: 2_000_000, reader_factory=Reader)
    assert result["state"] == "UCAMPUS_PROGRESS_UNAVAILABLE"
    assert result["total"] == result["passed"] == 0
    assert "cookie" not in json.dumps(result)


def test_damaged_checkpoint_fails_closed(store):
    store.write_text('{"version":1,"enabled":true,"course_id":"../secret"}')
    assert monitor.status()["enabled"] is False
    store.write_text("{invalid json")
    assert monitor.status()["enabled"] is False
