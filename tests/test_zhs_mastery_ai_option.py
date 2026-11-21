"""AI-mode options are isolated from the existing offline trial and ZHS playback."""
from studyflow.platforms.zhidao.mastery_helper import settings, worker


def test_ai_mode_default_and_api_cap():
    assert settings.DEFAULTS["use_ai"] is True
    assert settings.DEFAULTS["target"] == 100
    assert settings.DEFAULTS["max_api_calls"] >= 1


def test_worker_separates_ai_and_local_trial_counts(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "ROOT", tmp_path)
    state = worker.Reporter()
    state.emit("answered", source="bank")
    state.emit("answered", source="trial")
    state.emit("answered", source="ai")
    assert state.state["bank_hit"] == 1
    assert state.state["trial_count"] == 1
    assert state.state["ai_count"] == 1
