"""Restart recovery process lock contract tests."""
from studyflow.services import legacy_playback


def test_exclusive_worker_busy_separate_platform_and_release(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    with legacy_playback._exclusive_worker("zhidao"):
        assert legacy_playback._run_exclusive("zhidao", lambda: 0) == 10
        assert legacy_playback._run_exclusive("yuketang", lambda: 7) == 7
    assert legacy_playback._run_exclusive("zhidao", lambda: 8) == 8


def test_restart_retries_only_transient_lock_acquisition(monkeypatch):
    """A just-stopped worker releases its OS lock; the task runs exactly once."""
    from contextlib import contextmanager
    import errno

    attempts = []
    callbacks = []
    delays = []

    @contextmanager
    def lock(_platform):
        attempts.append("acquire")
        if len(attempts) < 3:
            raise legacy_playback._WorkerLockBusy(errno.EACCES, "finishing old run")
        yield

    monkeypatch.setattr(legacy_playback, "_exclusive_worker", lock)
    monkeypatch.setattr(legacy_playback.time, "sleep", delays.append)

    def run_once():
        callbacks.append("started")
        return 7

    assert legacy_playback._run_exclusive("zhidao", run_once) == 7
    assert len(attempts) == 3
    assert callbacks == ["started"]
    assert delays == [0.15, 0.15]


def test_busy_other_worker_does_not_trigger_duplicate_task(monkeypatch):
    """Never bypass a real process lock or run the protected callback twice."""
    from contextlib import contextmanager
    import errno

    attempts = []
    @contextmanager
    def locked(_platform):
        attempts.append(1)
        raise legacy_playback._WorkerLockBusy(errno.EAGAIN, "live other process")
        yield

    monkeypatch.setattr(legacy_playback, "_exclusive_worker", locked)
    monkeypatch.setattr(legacy_playback.time, "sleep", lambda _delay: None)
    assert legacy_playback._run_exclusive("zhidao", lambda: (_ for _ in ()).throw(
        AssertionError("duplicate task started"))) == 10
    assert len(attempts) == 8


def test_callback_file_error_is_not_replayed_as_lock_contention(monkeypatch, tmp_path):
    """A worker callback failure is never retried as though the lock were busy."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    attempts = []
    def fail():
        attempts.append("started")
        raise OSError("task failure")
    assert legacy_playback._run_exclusive("zhidao", fail) == 11
    assert attempts == ["started"]
