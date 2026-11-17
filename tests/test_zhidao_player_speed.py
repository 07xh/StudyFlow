"""Custom player speed validation, persistence and legacy compatibility."""
import pytest
from studyflow.platforms.zhidao import legacy_runtime

@pytest.mark.parametrize("rate", ["0.5", "0.75", "1", "1.23", "1.25", "2.5", "3.99", "4.00"])
def test_accepted_speed(rate):
    assert legacy_runtime._valid_player_speed(rate)

@pytest.mark.parametrize("rate", ["0", "0.49", "4.01", "1.234", "NaN", "Infinity", "1e2", "-1", "1,5", " 2", 2, None])
def test_rejected_speed(rate):
    assert not legacy_runtime._valid_player_speed(rate)

def test_speed_saved_and_read_back(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    settings = legacy_runtime.get_player_settings()
    settings["speed"] = "2.75"
    saved = legacy_runtime.save_player_settings(settings)
    assert saved["speed"] == "2.75"
    assert legacy_runtime.get_player_settings() == saved
    settings["speed"] = "4.01"
    with pytest.raises(ValueError, match="INVALID_PLAYER_SETTINGS"):
        legacy_runtime.save_player_settings(settings)
    assert legacy_runtime.get_player_settings() == saved
