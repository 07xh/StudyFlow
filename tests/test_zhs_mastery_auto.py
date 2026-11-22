"""No-network regression tests for the mastery course-wide scheduler."""
from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest

from studyflow.platforms.zhidao import zhs_mastery_auto as auto


COURSE = "a" * 64


def question(qid=100, kind=1):
    return {
        "question_id": qid,
        "question_type": kind,
        "content": "<p>测试问题</p>",
        "options": [
            {"id": 11, "content": "Alpha"},
            {"id": 12, "content": "Beta"},
        ] if kind != 3 else [],
    }


@pytest.fixture(autouse=True)
def clean(tmp_path, monkeypatch):
    monkeypatch.setattr(auto, "DATA", tmp_path)
    monkeypatch.setattr(auto, "STATUS_PATH", tmp_path / "status.json")
    monkeypatch.setattr(auto, "BANK_PATH", tmp_path / "bank.sqlite3")
    original = auto.AnswerBank
    monkeypatch.setattr(auto, "AnswerBank", lambda *args, **kwargs: original(tmp_path / "bank.sqlite3"))
    with auto._LOCK:
        auto._STATUS.clear()
        auto._THREAD = None
        auto._STOP.clear()
        auto._RESUME.set()
    yield
    with auto._LOCK:
        auto._STATUS.clear()
        auto._THREAD = None
        auto._STOP.clear()
        auto._RESUME.set()


def test_bank_unverified_guess_becomes_verified_after_official_result():
    bank = auto.AnswerBank()
    q = question()
    first,identity,texts = bank.choose(q)
    assert first == 11
    bank.attempted(identity,texts)
    second,identity2,texts2 = bank.choose(q)
    assert second == 12
    assert identity == identity2
    assert bank.confirm(q,{"isCorrect":True,"correctOptionIds":[12]},texts2)
    third,_,_=bank.choose(q)
    assert third == 12
    bank.close()


def test_unknown_fill_uses_placeholder_once_and_stops_without_official_answer():
    bank = auto.AnswerBank()
    fill = question(kind=3)
    candidate, identity, texts = bank.choose(fill)
    assert candidate == "待复习"
    assert texts == ["待复习"]
    bank.attempted(identity, texts)
    with pytest.raises(ValueError,match="尝试过一次"):
        bank.choose(fill)
    # Incorrect own answer without published correct text must not enter bank.
    assert bank.confirm(fill, {"isCorrect":False,"correctTexts":[]}, texts) is False
    bank.close()


def test_official_fill_answer_can_replace_placeholder_next_round():
    bank = auto.AnswerBank()
    fill = question(kind=3)
    candidate, identity, texts = bank.choose(fill)
    bank.attempted(identity, texts)
    assert bank.confirm(fill, {"isCorrect":False,
                               "correctTexts":["PhotoSynthesis"]}, texts) is True
    answer, _, _ = bank.choose(fill)
    assert answer == "PhotoSynthesis", "must preserve official answer case"
    bank.close()


def test_fake_fill_options_do_not_block_identity():
    bank = auto.AnswerBank()
    fill = question(kind=3)
    fill["options"] = [{"id":99, "content":""}]
    candidate, _, _ = bank.choose(fill)
    assert candidate == "待复习"
    bank.close()


def test_multi_choice_moves_to_next_untried_combination():
    bank = auto.AnswerBank()
    choice,identity,texts = bank.choose(question(kind=2))
    assert choice == [11]
    bank.attempted(identity,texts)
    next_choice,_,_=bank.choose(question(kind=2))
    assert next_choice == [12]
    bank.close()


def test_full_course_runs_multiple_rounds_then_advances(monkeypatch):
    point_a={"knowledge_id":"1001","name":"A","theme":"第一章","mastery":20,"free_exam":False}
    point_b={"knowledge_id":"1002","name":"B","theme":"第二章","mastery":100,"free_exam":False}
    calls=[]
    rounds=[]
    answers=[]
    def read_catalog(key,with_mastery):
        assert key==COURSE and with_mastery
        return {"knowledge":[point_a,point_b],"course_name":"测试课程"}
    def start_round(key,kid):
        assert kid=="1001"
        number=len(rounds)+1
        rounds.append(number)
        return {"exam_test_id":number,"questions":[question()]}
    def save_answer(key,kid,qid,choice):
        answers.append(choice)
    def check_saved_answers(key,kid):
        return {"complete":True,"answered":1,"total":1}
    def submit_round(key,kid):
        calls.append("submit")
        number=len(calls)
        return {
            "verification_pending":False,
            "graded":[{
                "questionId":100,"isCorrect":number==2,
                "correctOptionIds":[12], "correctTexts":["Beta"],
            }],
            "high_mastery_now": 65 if number==1 else 100,
        }
    monkeypatch.setattr(auto.service,"read_catalog",read_catalog)
    monkeypatch.setattr(auto.service,"start_round",start_round)
    monkeypatch.setattr(auto.service,"save_answer",save_answer)
    monkeypatch.setattr(auto.service,"check_saved_answers",check_saved_answers)
    monkeypatch.setattr(auto.service,"submit_round",submit_round)
    monkeypatch.setattr(auto.service,"active_round",lambda *args:None)
    auto._STATUS.update({"course_key":COURSE,"state":"starting","tasks":[]})
    auto._run(COURSE,{"target":100,"max_rounds":5,"stagnation_rounds":3,"max_minutes":20})
    state=auto.status(COURSE)
    assert state["state"]=="completed"
    assert state["done"]==2
    assert state["skipped"]==0
    assert len(rounds)==2 and len(calls)==2
    assert answers==[11,12], "second round must learn from official results"
    assert state["submitting"] is None


def test_incomplete_server_saved_answer_check_never_submits(monkeypatch):
    point={"knowledge_id":"1001","name":"A","theme":"章","mastery":10,"free_exam":False}
    monkeypatch.setattr(auto.service,"active_round",lambda *args:None)
    monkeypatch.setattr(auto.service,"start_round",lambda *args:{
        "exam_test_id":1,"questions":[question()],
    })
    monkeypatch.setattr(auto.service,"save_answer",lambda *args:None)
    monkeypatch.setattr(auto.service,"check_saved_answers",lambda *args:{
        "complete":False,"answered":0,"total":1,
    })
    monkeypatch.setattr(auto.service,"submit_round",lambda *args:
        pytest.fail("Must not submit an incomplete server-side sheet"))
    auto._STATUS.update({"course_key":COURSE,"tasks":[{
        **point,"state":"pending","rounds":0,"reason":"",
    }]})
    bank=auto.AnswerBank()
    passed,reason,_=auto._execute_point(COURSE,point,bank,auto.DEFAULTS,auto.time.monotonic()+10)
    assert not passed and "未提交" in reason
    bank.close()


def test_unknown_submit_is_not_retried(monkeypatch):
    point={"knowledge_id":"1001","name":"A","theme":"章","mastery":10,"free_exam":False}
    monkeypatch.setattr(auto.service,"active_round",lambda *args:None)
    monkeypatch.setattr(auto.service,"start_round",lambda *args:{
        "exam_test_id":1,"questions":[question()],
    })
    monkeypatch.setattr(auto.service,"save_answer",lambda *args:None)
    monkeypatch.setattr(auto.service,"check_saved_answers",lambda *args:{
        "complete":True,"answered":1,"total":1,
    })
    count=[0]
    def submit(*args):
        count[0]+=1
        raise auto.service.MasteryError("SUBMIT_STATUS_UNKNOWN")
    monkeypatch.setattr(auto.service,"submit_round",submit)
    auto._STATUS.update({"course_key":COURSE,"tasks":[{
        **point,"state":"pending","rounds":0,"reason":"",
    }]})
    bank=auto.AnswerBank()
    passed,reason,_=auto._execute_point(COURSE,point,bank,auto.DEFAULTS,auto.time.monotonic()+10)
    assert not passed and count==[1]
    assert auto.status(COURSE)["submitting"]["exam_test_id"]==1
    bank.close()


def test_interrupt_marker_is_carried_to_new_run(monkeypatch):
    auto._save({"course_key":COURSE,"state":"running",
                "submitting":{"knowledge_id":"1001","exam_test_id":666}})
    entered=threading.Event()
    release=threading.Event()
    def block_worker(*args):
        entered.set()
        release.wait(3)
    monkeypatch.setattr(auto,"_run",block_worker)
    status=auto.start(COURSE)
    assert entered.wait(1)
    assert status["blocked"]==["1001"]
    release.set()
    auto._THREAD.join(2)


def test_pause_stop_signals_do_not_reissue_submission(monkeypatch):
    entered=threading.Event()
    release=threading.Event()
    def block_worker(*args):
        entered.set()
        release.wait(3)
    monkeypatch.setattr(auto,"_run",block_worker)
    auto.start(COURSE)
    assert entered.wait(1)
    assert auto.control(COURSE,"pause")["state"]=="paused"
    assert auto.control(COURSE,"resume")["state"]=="running"
    assert auto.control(COURSE,"stop")["state"]=="stopping"
    release.set()
    auto._THREAD.join(2)


def test_ai_mode_requires_explicit_api_key():
    with pytest.raises(auto.service.MasteryError) as error:
        auto.start(COURSE, {"first_round_mode":"bank_ai"})
    assert error.value.code == "AI_KEY_REQUIRED"


def test_api_key_is_never_written_to_auto_status(monkeypatch):
    ready=threading.Event()
    release=threading.Event()
    def blocked(*args):
        ready.set()
        release.wait(3)
    monkeypatch.setattr(auto, "_run", blocked)
    start_state=auto.start(COURSE, {
        "first_round_mode":"ai_first",
        "api_key":"sk-private-test-only",
        "max_ai_calls":8,
    })
    assert ready.wait(1)
    assert "api_key" not in start_state.get("config", {})
    assert "sk-private-test-only" not in auto.STATUS_PATH.read_text(encoding="utf-8")
    release.set()
    auto._THREAD.join(2)


def _wire_strategy_rounds(monkeypatch, grades=(70, 100)):
    from studyflow.platforms.zhidao import zhs_mastery_auto as worker
    calls=[]
    sends=[]
    outcomes=iter(grades)
    monkeypatch.setattr(worker.service,"active_round",lambda *args:None)
    def start_round(*args):
        calls.append("start")
        return {"exam_test_id":len(calls),"questions":[question()]}
    monkeypatch.setattr(worker.service,"start_round",start_round)
    monkeypatch.setattr(worker.service,"save_answer",lambda *args:sends.append(args[-1]))
    monkeypatch.setattr(worker.service,"check_saved_answers",
                        lambda *args:{"complete":True,"answered":1,"total":1})
    def submit(*args):
        score=next(outcomes)
        return {"verification_pending":False,"graded":[{
            "questionId":100,"graded":True,"isCorrect":bool(sends[-1]==11),
            "correctOptionIds":[11], "correctTexts":["Alpha"],
        }],"high_mastery_now":score}
    monkeypatch.setattr(worker.service,"submit_round",submit)
    point={"knowledge_id":"1001","name":"A","theme":"章节","mastery":30,"free_exam":False}
    worker._STATUS.update({"course_key":COURSE,"tasks":[{**point,
                           "state":"pending","rounds":0,"reason":""}]})
    return point,calls,sends


def test_bank_ai_prefer_verified_answer_without_using_ai(monkeypatch):
    point,rounds,sends=_wire_strategy_rounds(monkeypatch,grades=(100,))
    bank=auto.AnswerBank()
    q=question()
    assert bank.confirm(q,{"isCorrect":True,"correctOptionIds":[11]},["alpha"])
    monkeypatch.setattr(auto,"ai_suggest",lambda *args:pytest.fail("verified bank should take precedence"))
    opts={**auto.DEFAULTS,"first_round_mode":"bank_ai","max_rounds":2}
    done,_,score=auto._execute_point(COURSE,point,bank,opts,auto.time.monotonic()+10,"sk-temporary")
    assert done and score==100
    assert sends==[11]
    assert auto._STATUS.get("ai_calls", 0) == 0
    bank.close()


def test_ai_first_only_on_first_round_then_uses_verified_bank(monkeypatch):
    point,rounds,sends=_wire_strategy_rounds(monkeypatch,grades=(70,100))
    calls=[]
    def ai_answer(*args):
        calls.append("ai")
        return 12
    monkeypatch.setattr(auto,"ai_suggest",ai_answer)
    bank=auto.AnswerBank()
    assert bank.confirm(question(),{"isCorrect":True,"correctOptionIds":[11]},["alpha"])
    opts={**auto.DEFAULTS,"first_round_mode":"ai_first","max_rounds":3}
    done,_,score=auto._execute_point(COURSE,point,bank,opts,auto.time.monotonic()+10,"sk-temporary")
    assert done and score==100
    assert sends==[12,11], "AI first, then verified official bank"
    assert calls==["ai"], "do not call AI again for same question"
    bank.close()


def test_bank_ai_queries_ai_only_on_cache_miss(monkeypatch):
    point,rounds,sends=_wire_strategy_rounds(monkeypatch,grades=(100,))
    calls=[]
    monkeypatch.setattr(auto,"ai_suggest",lambda *args:(calls.append("ai"),11)[1])
    bank=auto.AnswerBank()
    opts={**auto.DEFAULTS,"first_round_mode":"bank_ai","max_rounds":2}
    done,_,score=auto._execute_point(COURSE,point,bank,opts,auto.time.monotonic()+10,"sk-temporary")
    assert done and score==100
    assert sends==[11] and calls==["ai"]
    bank.close()


def test_invalid_ai_response_falls_back_to_bounded_trial(monkeypatch):
    point,rounds,sends=_wire_strategy_rounds(monkeypatch,grades=(100,))
    def unavailable(*args):
        raise auto.AiAnswerError("AI_UNCERTAIN")
    monkeypatch.setattr(auto,"ai_suggest",unavailable)
    bank=auto.AnswerBank()
    opts={**auto.DEFAULTS,"first_round_mode":"bank_ai","max_rounds":2}
    done,_,score=auto._execute_point(COURSE,point,bank,opts,auto.time.monotonic()+10,"sk-temporary")
    assert done and score==100 and sends==[11]
    bank.close()


def test_arbitrary_first_round_answers_all_types_without_bank():
    first_single, ident, texts = auto._arbitrary_first_answer(question())
    assert first_single == 11 and texts == ["alpha"]
    assert ident
    first_multi, _, multi_texts = auto._arbitrary_first_answer(question(kind=2))
    assert first_multi == [11] and multi_texts == ["alpha"]
    first_fill, _, fill_texts = auto._arbitrary_first_answer(question(kind=3))
    assert first_fill == "待复习" and fill_texts == ["待复习"]


def test_arbitrary_first_ignores_existing_bank_and_uses_graded_answer_second_round(monkeypatch):
    point, rounds, sends = _wire_strategy_rounds(monkeypatch, grades=(70, 100))
    bank = auto.AnswerBank()
    # Deliberately seed an answer at odds with the first option. The first
    # arbitrary round must bypass verified bank regardless of what's cached.
    bank.confirm(question(), {"isCorrect": True, "correctOptionIds": [12]}, ["beta"])
    monkeypatch.setattr(auto, "ai_suggest", lambda *args:
                        pytest.fail("arbitrary mode must not call AI"))
    opts = {**auto.DEFAULTS, "first_round_mode": "arbitrary_first", "max_rounds": 3}
    done, reason, score = auto._execute_point(
        COURSE, point, bank, opts, auto.time.monotonic() + 10, ""
    )
    assert done and score == 100, reason
    assert sends == [11, 11], "first is arbitrary, second uses server-confirmed answer"
    bank.close()


def test_arbitrary_first_unknown_fill_uses_official_answer_next_round(monkeypatch):
    point = {"knowledge_id": "1001", "name": "A", "theme": "章节",
             "mastery": 15, "free_exam": False}
    sent = []
    submissions = []
    monkeypatch.setattr(auto.service, "active_round", lambda *args: None)
    monkeypatch.setattr(auto.service, "start_round", lambda *args: {
        "exam_test_id": len(submissions) + 1, "questions": [question(kind=3)],
    })
    monkeypatch.setattr(auto.service, "save_answer", lambda *args: sent.append(args[-1]))
    monkeypatch.setattr(auto.service, "check_saved_answers", lambda *args: {
        "complete": True, "answered": 1, "total": 1,
    })
    def submit(*args):
        submissions.append(1)
        return {
            "verification_pending": False,
            "graded": [{
                "questionId": 100, "graded": True, "isCorrect": len(submissions) == 2,
                "correctOptionIds": [], "correctTexts": ["正确填空"],
            }],
            "high_mastery_now": 60 if len(submissions) == 1 else 100,
        }
    monkeypatch.setattr(auto.service, "submit_round", submit)
    auto._STATUS.update({"course_key": COURSE, "tasks": [{**point,
                         "state": "pending", "rounds": 0, "reason": ""}]})
    bank = auto.AnswerBank()
    opts = {**auto.DEFAULTS, "first_round_mode": "arbitrary_first", "max_rounds": 3}
    done, reason, score = auto._execute_point(
        COURSE, point, bank, opts, auto.time.monotonic() + 10
    )
    assert done and score == 100, reason
    assert sent == ["待复习", "正确填空"]
    assert len(submissions) == 2
    bank.close()



def test_ai_first_never_calls_ai_for_new_questions_after_first_round(monkeypatch):
    point={"knowledge_id":"1001","name":"A","theme":"第一章","mastery":25,"free_exam":False}
    rounds=[]
    answers=[]
    ai_calls=[]
    monkeypatch.setattr(auto.service,"active_round",lambda *args:None)
    def start_round(*args):
        number=len(rounds)+1
        q={**question(qid=100+number),"content":f"本轮新问题 {number}"}
        rounds.append(q)
        return {"exam_test_id":number,"questions":[q]}
    monkeypatch.setattr(auto.service,"start_round",start_round)
    monkeypatch.setattr(auto.service,"save_answer",lambda *args: answers.append(args[-1]))
    monkeypatch.setattr(auto.service,"check_saved_answers",lambda *args:{
        "complete":True,"answered":1,"total":1,
    })
    def submit(*args):
        number=len(answers)
        return {"verification_pending":False,"graded":[{
            "questionId":rounds[-1]["question_id"],"graded":True,
            "isCorrect":number==2,"correctOptionIds":[11],"correctTexts":["Alpha"],
        }],"high_mastery_now":65 if number==1 else 100}
    monkeypatch.setattr(auto.service,"submit_round",submit)
    def suggest(*args):
        ai_calls.append("called")
        return 12
    monkeypatch.setattr(auto,"ai_suggest",suggest)
    auto._STATUS.update({"course_key":COURSE,"tasks":[{
        **point,"state":"pending","rounds":0,"reason":"",
    }]})
    bank=auto.AnswerBank()
    opts={**auto.DEFAULTS,"first_round_mode":"ai_first","max_rounds":3}
    done,reason,score=auto._execute_point(COURSE,point,bank,opts,
        auto.time.monotonic()+10,"sk-temporary")
    assert done and score==100,reason
    assert answers==[12,11],"AI only the first paper; second is an unverified new question"
    assert ai_calls==["called"]
    bank.close()



def test_sidecar_jsonl_start_then_status_uses_same_background_task(monkeypatch):
    """The long-lived native sidecar must keep the scheduler alive between IPC calls."""
    import io
    import json
    from studyflow.services import bridge

    active = threading.Event()
    release = threading.Event()

    def background(*args):
        active.set()
        release.wait(timeout=4)

    monkeypatch.setattr(auto, "_run", background)
    commands = [
        {"id": "start", "version": 1, "operation": "zhidao.mastery.auto.start",
         "course_key": COURSE, "settings": {**auto.DEFAULTS,
                         "first_round_mode": "arbitrary_first"}},
        {"id": "status", "version": 1, "operation": "zhidao.mastery.auto.status",
         "course_key": COURSE},
    ]
    payload = b"".join(json.dumps(item).encode("utf-8") + b"\n" for item in commands)
    fake_input = SimpleNamespace(buffer=io.BytesIO(payload))
    monkeypatch.setattr(bridge.sys, "stdin", fake_input)
    output = io.StringIO()
    try:
        assert bridge.main(output) == 0
        assert active.wait(2)
        responses = [json.loads(x) for x in output.getvalue().splitlines()]
        assert len(responses) == 2
        assert responses[0]["ok"] is True and responses[1]["ok"] is True
        first = responses[0]["data"]
        second = responses[1]["data"]
        assert first["run_id"] == second["run_id"]
        assert second["state"] in {"starting", "running"}
        assert auto._THREAD is not None and auto._THREAD.is_alive()
    finally:
        release.set()
        if auto._THREAD:
            auto._THREAD.join(3)



def test_restored_pending_paper_readback_allows_completion_without_another_post(monkeypatch):
    point = {"knowledge_id": "1001", "name": "A", "theme": "章",
             "mastery": 10, "free_exam": False}
    marker = {"knowledge_id": "1001", "exam_test_id": 123,
              "exam_paper_id": 456, "question_ids": [100]}
    auto._STATUS.update({"course_key": COURSE, "state": "starting",
                         "tasks": [], "blocked": ["1001"],
                         "pending_submissions": {"1001": marker}})
    monkeypatch.setattr(auto.service, "read_catalog", lambda *args, **kwargs:
                        {"knowledge": [point], "course_name": "恢复"})
    recovered = []
    def verify(course_key, kid, exam_test_id, paper_id, question_ids):
        recovered.append((course_key, kid, exam_test_id, paper_id, question_ids))
        return {"submitted": True, "grading_complete": True, "mastery": 100}
    monkeypatch.setattr(auto.service, "verify_previous_submission", verify)
    monkeypatch.setattr(auto.service, "start_round", lambda *args: pytest.fail("should not create a new paper"))
    monkeypatch.setattr(auto.service, "submit_round", lambda *args: pytest.fail("should never rePOST"))

    auto._run(COURSE, {"target": 100, "max_rounds": 2,
                       "max_minutes": 5, "stagnation_rounds": 2})
    state = auto.status(COURSE)
    assert state["state"] == "completed"
    assert state["done"] == 1
    assert state["blocked"] == []
    assert state["pending_submissions"] == {}
    assert recovered == [(COURSE, "1001", 123, 456, [100])]


def test_unconfirmed_previous_paper_stops_entire_course_before_any_write(monkeypatch):
    points = [{"knowledge_id": str(k), "name": str(k),
               "theme": "章", "mastery": 5, "free_exam": False}
              for k in (1001, 1002)]
    marker = {"knowledge_id": "1001", "exam_test_id": 123,
              "exam_paper_id": 456, "question_ids": [100]}
    auto._STATUS.update({"course_key": COURSE, "state": "starting",
                         "tasks": [], "blocked": ["1001"],
                         "pending_submissions": {"1001": marker}})
    monkeypatch.setattr(auto.service, "read_catalog", lambda *args, **kwargs:
                        {"knowledge": points, "course_name": "恢复"})
    monkeypatch.setattr(auto.service, "verify_previous_submission", lambda *args:
                        {"submitted": True, "grading_complete": False, "mastery": None})
    monkeypatch.setattr(auto.service, "start_round", lambda *args: pytest.fail("must not open a new paper"))
    monkeypatch.setattr(auto.service, "submit_round", lambda *args: pytest.fail("must not submit"))
    auto._run(COURSE, {"target": 100, "max_rounds": 2,
                       "max_minutes": 5, "stagnation_rounds": 2})
    state = auto.status(COURSE)
    assert state["state"] == "needs_attention"
    assert state["processed"] == 1
    assert state["blocked"] == ["1001"]
    assert state["tasks"][1]["state"] == "pending"


def test_current_mastery_does_not_inherit_an_old_historical_high(monkeypatch):
    point = {"knowledge_id": "1001", "name": "A", "theme": "章",
             "mastery": 15, "free_exam": False}
    auto._STATUS.update({"course_key": COURSE, "state": "running",
                         "tasks": [{**point, "state": "pending", "rounds": 0, "reason": ""}]})
    monkeypatch.setattr(auto.service, "active_round", lambda *args: None)
    monkeypatch.setattr(auto.service, "start_round", lambda *args:
                        {"exam_test_id": 123, "exam_paper_id": 456, "questions": [question()]})
    monkeypatch.setattr(auto.service, "save_answer", lambda *args: None)
    monkeypatch.setattr(auto.service, "check_saved_answers", lambda *args:
                        {"complete": True, "answered": 1, "total": 1})
    monkeypatch.setattr(auto.service, "submit_round", lambda *args:
                        {"verification_pending": False,
                         "graded": [{"questionId": 100, "isCorrect": True, "correctOptionIds": [11]}],
                         "mastery_after": {"mastery": 20}, "high_mastery_now": 100})
    bank = auto.AnswerBank()
    try:
        passed, reason, score = auto._execute_point(
            COURSE, point, bank, {"target": 90, "max_rounds": 1,
                                  "stagnation_rounds": 3, "max_minutes": 5},
            auto.time.monotonic() + 5,
        )
    finally:
        bank.close()
    assert passed is False
    assert score == 20
    assert "最大轮次" in reason



def test_course_snapshots_survive_switching_and_retain_pending_submission():
    """Starting another course cannot delete a different course's recovery data."""
    course_b = "b" * 64
    pending = {"knowledge_id": "1001", "exam_test_id": 31,
               "exam_paper_id": 41, "question_ids": [100]}
    auto._save({
        "course_key": COURSE, "state": "needs_attention",
        "submitting": pending, "blocked": ["1001"],
        "pending_submissions": {"1001": pending},
        "tasks": [], "total": 0, "processed": 0, "done": 0, "skipped": 0,
    })
    auto._save({
        "course_key": course_b, "state": "completed",
        "submitting": None, "blocked": [], "pending_submissions": {},
        "tasks": [], "total": 0, "processed": 0, "done": 0, "skipped": 0,
    })
    state_a = auto.status(COURSE)
    assert state_a["state"] == "needs_attention"
    assert state_a["submitting"] == pending
    assert state_a["pending_submissions"]["1001"] == pending
    assert auto.status(course_b)["state"] == "completed"

    # Restart the process: recover each original course, never the last course.
    auto._STATUS.clear()
    assert auto._loaded(COURSE)["blocked"] == ["1001"]
    assert auto._loaded(course_b)["blocked"] == []


def test_course_snapshot_migrates_legacy_last_run_file():
    import json
    marker = {"knowledge_id": "1001", "exam_test_id": 31}
    auto.STATUS_PATH.write_text(json.dumps({
        "course_key": COURSE, "state": "running",
        "submitting": marker, "blocked": ["1001"],
    }), encoding="utf-8")
    recovered = auto._loaded(COURSE)
    assert recovered["state"] == "interrupted"
    assert recovered["submitting"] == marker
    assert auto._loaded("b" * 64) == {}
    assert not auto._course_status_path(COURSE).exists()


def test_course_journal_rejects_unsafe_file_name():
    with pytest.raises(ValueError):
        auto._course_status_path("../" + "a" * 64)



def test_new_run_restores_own_course_marker_not_last_opened_course(monkeypatch):
    """The latest unrelated course must not hide an older unresolved POST."""
    course_b = "b" * 64
    marker = {"knowledge_id": "1001", "exam_test_id": 31,
              "exam_paper_id": 41, "question_ids": [100]}
    auto._save({"course_key": COURSE, "state": "needs_attention",
                "submitting": marker, "blocked": ["1001"],
                "pending_submissions": {"1001": marker}})
    auto._save({"course_key": course_b, "state": "completed",
                "submitting": None, "blocked": [], "pending_submissions": {}})
    monkeypatch.setattr(auto, "_run", lambda *args: None)
    resumed = auto.start(COURSE)
    auto._THREAD.join(1)
    assert resumed["blocked"] == ["1001"]
    assert resumed["pending_submissions"]["1001"] == marker
    assert resumed["submitting"] is None
    assert auto._course_status_path(course_b).exists()



def test_upgrade_migrates_old_course_before_new_course_overwrites_last_run():
    import json
    course_b = "b" * 64
    old_marker = {"knowledge_id": "1001", "exam_test_id": 31,
                  "exam_paper_id": 41, "question_ids": [100]}
    # Simulate rc.55: only the legacy global status exists.
    auto.STATUS_PATH.write_text(json.dumps({
        "course_key": COURSE, "state": "needs_attention",
        "submitting": old_marker, "blocked": ["1001"],
        "pending_submissions": {"1001": old_marker},
    }), encoding="utf-8")
    assert not auto._course_status_path(COURSE).exists()
    # First rc.56 write belongs to unrelated course B.
    auto._save({"course_key": course_b, "state": "completed",
                "blocked": [], "pending_submissions": {}, "submitting": None})
    old = auto._loaded(COURSE)
    assert old["blocked"] == ["1001"]
    assert old["pending_submissions"]["1001"] == old_marker
    assert auto._loaded(course_b)["state"] == "completed"
