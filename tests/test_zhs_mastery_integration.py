"""Local-only smoke tests for the MIT-licensed Zhidao mastery integration."""
import pytest
from studyflow.platforms.zhidao.mastery_helper import settings, worker


def test_mastery_defaults_are_100_percent_and_bounded():
    assert settings.DEFAULTS["target"] == 100
    assert settings.DEFAULTS["max_rounds"] == 20
    assert settings.DEFAULTS["max_api_calls"] > 0


def test_mastery_settings_do_not_store_api_key_in_plaintext(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ROOT", tmp_path)
    monkeypatch.setattr(settings, "PROFILE", tmp_path / "profile.json")
    monkeypatch.setattr(settings, "DATA", tmp_path / "data")
    saved = settings.save_settings({
        "target": 100, "max_rounds": 2, "max_api_calls": 10,
        "max_minutes": 5, "next_scope": "chapter", "auto_next": True,
        "browser": "msedge"
    })
    assert saved["target"] == 100
    raw = (tmp_path / "profile.json").read_text(encoding="utf-8")
    assert "api_key" not in raw
    assert "last_work_url" not in raw


def test_mastery_entry_url_requires_official_https(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ROOT", tmp_path)
    monkeypatch.setattr(settings, "PROFILE", tmp_path / "profile.json")
    monkeypatch.setattr(settings, "DATA", tmp_path / "data")
    assert settings.valid_official_url("https://studentexamtest.zhihuishu.com/test")
    assert settings.valid_official_url("https://hike-teaching-center.polymas.com/")
    assert not settings.valid_official_url("https://zhihuishu.com.evil.example/")
    assert not settings.valid_official_url("http://studentexamtest.zhihuishu.com/")
    with pytest.raises(ValueError):
        settings.save_settings({"entry_url": "https://zhihuishu.com.evil.example/"})


def test_worker_reporter_persists_progress_without_running_platform(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "ROOT", tmp_path)
    reporter = worker.Reporter()
    reporter.emit("metadata", course_title="测试课程", chapter_title="第一章", knowledge_title="知识点一")
    reporter.emit("round", round=2)
    reporter.emit("answered", source="bank")
    reporter.emit("answered", source="ai")
    reporter.emit("score", mastery=75)
    reporter.emit("point_done")
    assert reporter.state["bank_hit"] == 1
    assert reporter.state["ai_count"] == 1
    assert reporter.state["mastery"] == 75
    assert reporter.state["points_completed"] == 1
    assert (tmp_path / "status.json").is_file()
