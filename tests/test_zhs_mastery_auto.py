"""Pure HTTP mastery auto worker tests. No network, browser or real ZHS session."""
from __future__ import annotations

import time

import pytest

from studyflow.platforms.zhidao import zhs_mastery_auto as auto


COURSE_KEY = "a" * 64
KNOWLEDGE_ID = "1853343377786015744"
QUESTION = {
    "question_id": 939136618, "question_type": 1,
    "content": "测试问题", "options": [
        {"id": 5, "content": "错误选项"},
        {"id": 7, "content": "正确选项"},
    ],
}


@pytest.fixture(autouse=True)
def reset_worker(tmp_path, monkeypatch):
    # Tests do not create any file in the user's profile.
    monkeypatch.setattr(auto, "_BANK", tmp_path / "verified.json")
    monkeypatch.setattr(auto, "_ROOT", tmp_path)
    auto._STOP.set()
    thread = auto._THREAD
    if thread and thread.is_alive():
        thread.join(timeout=3)
    auto._STOP.clear()
    auto._PAUSE.clear()
    with auto._LOCK:
        auto._PAUSED_AT = None
        auto._PAUSED_SECONDS = 0.0

        auto._THREAD = None
        auto._STATE.clear()
        auto._STATE.update({
            "state": "idle", "phase": "未启动", "message": "", "knowledge": "",
            "course_key": "", "round": 0, "points_done": 0, "points_total": 0,
            "bank_hit": 0, "ai_count": 0, "ai_calls": 0, "mastery": None, "logs": [],
        })
    yield
    auto._STOP.set()
    thread = auto._THREAD
    if thread and thread.is_alive():
        thread.join(timeout=3)


def _wait():
    for _ in range(550):  # covers two 1-second read-only verification waits
        snap = auto.status()
        if snap["state"] not in ("running", "paused", "stopping"):
            return snap
        time.sleep(0.01)
    raise AssertionError("worker did not stop")


def _wire(monkeypatch, *, mastery_score=100):
    call_log = []
    state = {"submitted": False}

    def catalog(course_key, with_mastery=True):
        assert course_key == COURSE_KEY and with_mastery
        return {"knowledge": [{
            "knowledge_id": KNOWLEDGE_ID, "name": "知识点一",
            "mastery": 40, "free_exam": False,
        }]}

    def active(course_key, kid):
        return None

    def start_round(course_key, kid):
        assert kid == KNOWLEDGE_ID
        call_log.append(("start", kid))
        return {"questions": [QUESTION], "exam_test_id": 33}

    def save(course_key, kid, question_id, answer):
        call_log.append(("save", question_id, answer))

    def submit(course_key, kid):
        call_log.append(("submit", kid))
        state["submitted"] = True
        return {
            "submitted": True, "grading_pending": False,
            "verification_pending": False,
            "mastery_after": {"mastery": mastery_score},
            "graded": [{
                "questionId": 939136618, "graded": True,
                "isCorrect": True, "correctOptionIds": [7],
            }],
        }

    monkeypatch.setattr(auto.mastery, "read_catalog", catalog)
    monkeypatch.setattr(auto.mastery, "active_round", active)
    monkeypatch.setattr(auto.mastery, "start_round", start_round)
    monkeypatch.setattr(auto.mastery, "save_answer", save)
    monkeypatch.setattr(auto.mastery, "submit_round", submit)
    return call_log, state


def test_ai_fallback_submits_and_learns_only_from_server_grade(monkeypatch):
    calls, state = _wire(monkeypatch)
    ai_calls = []

    def solve(question, key, remaining):
        ai_calls.append((question["question_id"], key))
        return 7

    monkeypatch.setattr(auto, "_ai_answer", solve)
    auto.start(COURSE_KEY, {
        "target": 90, "max_rounds": 1, "max_minutes": 1,
        "use_ai": True, "api_key": "sk-example-not-persisted",
    })
    snap = _wait()

    assert snap["state"] == "completed"
    assert snap["points_done"] == 1
    assert snap["ai_count"] == 1
    assert len(ai_calls) == 1
    assert calls == [
        ("start", KNOWLEDGE_ID), ("save", "939136618", 7),
        ("submit", KNOWLEDGE_ID),
    ]
    assert state["submitted"] is True
    bank = auto._load_bank()
    assert bank[auto._signature(QUESTION, COURSE_KEY)] == ["正确选项"]
    assert "sk-example-not-persisted" not in repr(snap)
    assert "sk-example-not-persisted" not in auto._BANK.read_text(encoding="utf-8")


def test_verified_bank_solves_without_ai_or_external_calls(monkeypatch):
    calls, _ = _wire(monkeypatch)
    auto._store_verified(auto._signature(QUESTION, COURSE_KEY), ["正确选项"])

    def ai_fail(*args):
        raise AssertionError("AI must not be called on a verified bank hit")

    monkeypatch.setattr(auto, "_ai_answer", ai_fail)
    auto.start(COURSE_KEY, {"max_rounds": 1, "max_minutes": 1})
    snap = _wait()

    assert snap["state"] == "completed"
    assert snap["bank_hit"] == 1
    assert snap["ai_calls"] == 0
    assert ("save", "939136618", 7) in calls


def test_unknown_question_stops_before_save_or_submit(monkeypatch):
    calls, _ = _wire(monkeypatch)
    auto.start(COURSE_KEY, {"max_rounds": 1, "max_minutes": 1})
    snap = _wait()
    assert snap["state"] == "needs_attention"
    assert "题库未命中" in snap["message"]
    assert not any(call[0] in ("save", "submit") for call in calls)


def test_server_result_pending_never_reports_success(monkeypatch):
    calls, _ = _wire(monkeypatch)
    auto._store_verified(auto._signature(QUESTION, COURSE_KEY), ["正确选项"])
    monkeypatch.setattr(auto.mastery, "submit_round", lambda *a: {
        "verification_pending": True, "mastery_after": None,
    })
    auto.start(COURSE_KEY, {"max_rounds": 1, "max_minutes": 1})
    snap = _wait()
    assert snap["state"] == "needs_attention"
    assert snap["points_done"] == 0
    assert ("save", "939136618", 7) in calls


def test_rejects_invalid_options_and_missing_ai_key():
    with pytest.raises(ValueError):
        auto.start(COURSE_KEY, {"use_ai": True})
    with pytest.raises(ValueError):
        auto.start(COURSE_KEY, {"max_rounds": 1000})
    with pytest.raises(ValueError):
        auto.start("../", {})
    assert auto.status()["state"] == "idle"


def test_pause_excludes_wait_time_from_runtime_limit(monkeypatch):
    # The worker's maximum duration is active work time, not wall time.
    clock = [100.0]
    monkeypatch.setattr(auto.time, "monotonic", lambda: clock[0])
    with auto._LOCK:
        auto._STATE["state"] = "running"
    deadline = auto._active_now() + 30

    assert auto.pause()["state"] == "paused"
    clock[0] += 120  # A long pause must not consume the remaining 30 seconds.
    assert auto._active_now() == pytest.approx(100.0)
    assert auto.resume()["state"] == "running"
    clock[0] += 29
    auto._checkpoint(deadline)
    clock[0] += 2
    with pytest.raises(auto.AutoNeedsInput, match="时长上限"):
        auto._checkpoint(deadline)


def test_multiple_pauses_are_counted_once(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(auto.time, "monotonic", lambda: clock[0])
    with auto._LOCK:
        auto._STATE["state"] = "running"

    auto.pause()
    clock[0] += 100
    auto.resume()
    clock[0] += 10
    auto.pause()
    clock[0] += 200
    # Repeated pause must not replace the original pause start time.
    auto.pause()
    clock[0] += 100
    auto.resume()
    assert auto._active_now() == pytest.approx(110.0)
    assert auto._PAUSED_SECONDS == pytest.approx(400.0)
