"""No-network smoke tests for StudyFlow's MIT-licensed mastery integration."""
import json
import pytest
from studyflow.platforms.zhidao.mastery_helper import settings, worker, mastery
from studyflow.platforms.zhidao.mastery_helper.local_trial import LocalTrial


def test_mastery_defaults_target_100_with_bounded_trials():
    assert settings.DEFAULTS["target"] == 100
    assert 1 <= settings.DEFAULTS["max_rounds"] <= 30


def test_mastery_settings_are_local_and_never_require_ai(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ROOT", tmp_path)
    monkeypatch.setattr(settings, "PROFILE", tmp_path / "profile.json")
    monkeypatch.setattr(settings, "DATA", tmp_path / "data")
    saved = settings.save_settings({
        "target": 100, "max_rounds": 3, "max_api_calls": 10,
        "max_minutes": 5, "next_scope": "chapter", "auto_next": True,
        "browser": "msedge"
    })
    assert saved["target"] == 100
    assert "has_api_key" not in saved
    raw = (tmp_path / "profile.json").read_text(encoding="utf-8")
    assert "api_key" not in raw
    assert "last_work_url" not in raw


def test_entry_url_is_official_https_only(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ROOT", tmp_path)
    monkeypatch.setattr(settings, "PROFILE", tmp_path / "profile.json")
    monkeypatch.setattr(settings, "DATA", tmp_path / "data")
    assert settings.valid_official_url("https://studentexamtest.zhihuishu.com/test")
    assert settings.valid_official_url("https://hike-teaching-center.polymas.com/")
    assert not settings.valid_official_url("https://zhihuishu.com.evil.example/")
    assert not settings.valid_official_url("http://studentexamtest.zhihuishu.com/")
    with pytest.raises(ValueError):
        settings.save_settings({"entry_url": "https://zhihuishu.com.evil.example/"})


def test_local_trial_uses_review_before_attempting_new_option():
    q = mastery.Question("判断某事件", "single", ["A. 正确", "B. 错误"])
    answer, source = LocalTrial().answer(q, [{"correct_text": "B", "outcome": "wrong"}])
    assert answer == [q.options[1]]
    assert "解析" in source


def test_local_trial_rejects_old_wrong_option():
    q = mastery.Question("变量类型", "single", ["A. 字符串", "B. 整数"])
    answer, source = LocalTrial().answer(q, [
        {"rejected_answer": [q.options[0]]}
    ])
    assert answer == [q.options[1]]
    assert "试答" in source


def test_local_trial_stops_on_unknown_text():
    q = mastery.Question("解释变量", "text", [], blanks=1)
    with pytest.raises(mastery.Halt):
        LocalTrial().answer(q, [])


def test_worker_reporter_tracks_local_trials_not_ai(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "ROOT", tmp_path)
    reporter = worker.Reporter()
    reporter.emit("metadata", course_title="测试课程", chapter_title="第一章", knowledge_title="知识点一")
    reporter.emit("round", round=2)
    reporter.emit("answered", source="bank")
    reporter.emit("answered", source="trial")
    reporter.emit("score", mastery=75)
    reporter.emit("point_done")
    assert reporter.state["bank_hit"] == 1
    assert reporter.state["trial_count"] == 1
    assert reporter.state["mastery"] == 75
    assert reporter.state["points_completed"] == 1
    assert json.loads((tmp_path / "status.json").read_text(encoding="utf-8"))["round"] == 2
