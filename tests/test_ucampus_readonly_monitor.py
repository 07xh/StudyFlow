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


def test_failed_refresh_hides_previously_verified_counts(store):
    monitor.configure("course-v2:eng+course+1", "U1", True)
    class First:
        def list_tasks(self, course_id, unit_id):
            return [{"id": "v", "completed": True}]
    assert monitor.tick(clock=lambda: 2_000_000, reader_factory=First)["passed"] == 1
    class Fails:
        def list_tasks(self, course_id, unit_id):
            raise UCampusProgressError("UCAMPUS_SESSION_EXPIRED")
    result = monitor.tick(clock=lambda: 2_000_070, reader_factory=Fails)
    assert result["state"] == "UCAMPUS_SESSION_EXPIRED"
    assert (result["total"], result["passed"], result["checked_at"]) == (0, 0, "")


def test_inflight_read_does_not_block_disable_or_resurrect_old_monitor(store):
    import threading
    import time

    monitor.configure("course-v2:eng+course+1", "U1", True)
    entered, release = threading.Event(), threading.Event()
    results = []

    class SlowReader:
        def list_tasks(self, course_id, unit_id):
            entered.set()
            assert release.wait(timeout=3)
            return [{"id": "v", "completed": True}]

    worker = threading.Thread(
        target=lambda: results.append(monitor.tick(clock=lambda: 2_000_000, reader_factory=SlowReader)),
        daemon=True,
    )
    worker.start()
    try:
        assert entered.wait(timeout=1)
        start = time.monotonic()
        disabled = monitor.configure("", "", False)
        assert time.monotonic() - start < 0.5, "slow GET blocked monitor controls"
        assert disabled["enabled"] is False
    finally:
        release.set()
        worker.join(timeout=2)
    assert not worker.is_alive()
    assert results[0]["enabled"] is False
    assert monitor.status()["enabled"] is False
    assert not store.exists()


def test_inflight_old_course_read_cannot_overwrite_reconfigured_course(store):
    import threading

    monitor.configure("course-v2:eng+course+1", "U1", True)
    entered, release = threading.Event(), threading.Event()

    class SlowReader:
        def list_tasks(self, course_id, unit_id):
            assert course_id == "course-v2:eng+course+1"
            entered.set()
            assert release.wait(timeout=3)
            return [{"id": "old", "completed": True}]

    worker = threading.Thread(
        target=lambda: monitor.tick(clock=lambda: 2_000_000, reader_factory=SlowReader),
        daemon=True,
    )
    worker.start()
    try:
        assert entered.wait(timeout=1)
        second = monitor.configure("course-v2:eng+course+2", "U2", True)
        assert second["state"] == "pending"
    finally:
        release.set()
        worker.join(timeout=2)
    assert not worker.is_alive()
    latest = monitor.status()
    assert latest["enabled"] is True
    assert latest["course_id"] == "course-v2:eng+course+2"
    assert latest["unit_id"] == "U2"
    assert latest["state"] == "pending"
    assert (latest["passed"], latest["total"]) == (0, 0)


def test_simultaneous_ticks_claim_only_one_readonly_get(store):
    import threading

    monitor.configure("course-v2:eng+course+1", "U1", True)
    entered, release = threading.Event(), threading.Event()
    calls = []

    class SlowReader:
        def list_tasks(self, course_id, unit_id):
            calls.append((course_id, unit_id))
            entered.set()
            assert release.wait(timeout=3)
            return [{"id": "v", "completed": False}]

    worker = threading.Thread(
        target=lambda: monitor.tick(clock=lambda: 2_000_000, reader_factory=SlowReader),
        daemon=True,
    )
    worker.start()
    try:
        assert entered.wait(timeout=1)
        pending = monitor.tick(clock=lambda: 2_000_001, reader_factory=SlowReader)
        assert pending["state"] == "pending"
        assert len(calls) == 1
    finally:
        release.set()
        worker.join(timeout=2)
    assert not worker.is_alive()
    assert monitor.status()["state"] == "verified"
    assert len(calls) == 1


def test_clock_rollback_resumes_readonly_polling_without_request_storm(store):
    monitor.configure("course-v2:eng+course+1", "U1", True)
    calls = []

    class Reader:
        def list_tasks(self, course_id, unit_id):
            calls.append((course_id, unit_id))
            return [{"id": "v", "completed": True}]

    first = monitor.tick(clock=lambda: 2_000_000, reader_factory=Reader)
    assert first["state"] == "verified"
    assert len(calls) == 1

    # A Windows clock adjustment can make the persisted last_attempt appear
    # to be in the future. One fresh GET must be allowed, rather than
    # suppressing all reads until the old wall-clock timestamp is reached.
    rolled_back = monitor.tick(clock=lambda: 1_999_000, reader_factory=Reader)
    assert rolled_back["state"] == "verified"
    assert len(calls) == 2

    monitor.tick(clock=lambda: 1_999_010, reader_factory=Reader)
    assert len(calls) == 2, "ordinary 60-second pacing must still apply"
