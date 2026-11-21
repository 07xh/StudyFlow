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
            {"id": 11, "content": "甲"},
            {"id": 12, "content": "乙"},
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


def test_unknown_fill_is_not_fabricated():
    bank = auto.AnswerBank()
    with pytest.raises(ValueError,match="填空"):
        bank.choose(question(kind=3))
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
                "correctOptionIds":[12], "correctTexts":["乙"],
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
