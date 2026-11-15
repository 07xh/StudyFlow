"""Restart recovery process lock contract tests."""
from studyflow.services import legacy_playback


def test_exclusive_worker_busy_separate_platform_and_release(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    with legacy_playback._exclusive_worker("zhidao"):
        assert legacy_playback._run_exclusive("zhidao", lambda: 0) == 10
        assert legacy_playback._run_exclusive("yuketang", lambda: 7) == 7
    assert legacy_playback._run_exclusive("zhidao", lambda: 8) == 8
