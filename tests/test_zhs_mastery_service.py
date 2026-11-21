"""掌握度服务层（bridge 与 zhs 会话之间的那一层）的离线测试。

这里不碰网络、不碰 ``zhs``：用一个假 session 顶替 ``_open_session`` 的返回值，
只验证服务层自己的职责——

* 域名取自 ``session.urls``（用户在配置里改地址时不会写出第二份硬编码）；
* 读掌握度是只读的，不会新建试卷；
* 存答案发的是拼好的字符串，提交发的是官方五字段；
* 提交后按回读的判分算本轮得分，并把本地这一轮清掉；
* 刷新恢复时把线上答案还原成界面能回填的形状。
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from studyflow.platforms.zhidao import zhs_mastery_service as service
from studyflow.platforms.zhidao.zhs_mastery import ANSWER_SEPARATOR_CHOICE

COURSE = {
    "course_id": "2095430049486426112",
    "class_id": "339597",
    "course_type": "ai",
    "title": "AI 课程",
}
KNOWLEDGE = "1853343377786015744"

QUESTION_1 = {
    "id": 939136618, "content": "关键词是", "questionType": 1,
    "questionTypeName": "单选题",
    "optionVos": [
        {"id": 671372791, "content": "新思想", "sort": 1, "isCorrect": None},
        {"id": 671372794, "content": "新时代", "sort": 2, "isCorrect": None},
    ],
    "userAnswerVo": None,
    "analysisVo": None,
}
QUESTION_2 = {
    "id": 939136619, "content": "这个新时代是", "questionType": 2,
    "questionTypeName": "多选题",
    "optionVos": [
        {"id": 671372795, "content": "甲", "sort": 1, "isCorrect": None},
        {"id": 671372796, "content": "乙", "sort": 2, "isCorrect": None},
    ],
    "userAnswerVo": None,
    "analysisVo": None,
}
QUESTIONS = {939136618: QUESTION_1, 939136619: QUESTION_2}
CORRECT = {939136618: [671372794], 939136619: [671372795]}


class FakeSession:
    """记录每一次调用，并按 URL 后缀回真实形状的响应包络。"""

    def __init__(self, mastery=40):
        self.urls = SimpleNamespace(
            ai="https://kg-ai-run.example", exam="https://exam.example",
        )
        self.crypto = SimpleNamespace(key_bytes=lambda name: b"key")
        self.calls: list[tuple] = []
        self.papers: list[dict] = []
        self.answers: dict[int, str] = {}
        self.submitted = False
        self.mastery = mastery
        self.closed = 0

    # -- 三个通道 -------------------------------------------------------
    def zhidao_query(self, url, data, key=None, ok_code=200, content_type="json"):
        self.calls.append(("ai", url, dict(data)))
        if url.endswith("/mastery-statistics/get-knowledge-mastery-stat"):
            return {"code": 200, "data": {"mastery": self.mastery}}
        if url.endswith("/exam/questions-paper"):
            paper = {
                "masteryScore": self.mastery, "highMasteryScore": self.mastery,
                "masteryChange": 0, "examTestId": 4263949 + len(self.papers),
                "paperId": 454449917 + len(self.papers),
                "questionNum": len(QUESTIONS), "error": None,
            }
            self.papers.append(paper)
            self.answers, self.submitted = {}, False
            return {"code": 200, "data": paper}
        raise AssertionError(f"unexpected ai url {url}")

    def ai_exam_query(self, url, data, method="POST"):
        self.calls.append(("exam", url, dict(data), method))
        if url.endswith("/exam/user/openExam"):
            return {"code": 0, "data": True}
        if url.endswith("/answer/saveAnswer"):
            self.answers[data["questionId"]] = data["answer"]
            return {"code": 0, "data": True}
        if url.endswith("/exam/user/getExamSheetInfo"):
            rows = [
                {"questionId": qid, "version": 1, "sort": str(index),
                 "answerState": 2 if qid in self.answers else 1}
                for index, qid in enumerate(QUESTIONS, start=1)
            ]
            return {"code": 0, "data": {
                "partSheetVos": [{"name": "知识点练习默认部分", "questionSheetVos": rows}],
                "answerCount": len(self.answers), "questionCount": len(QUESTIONS),
            }}
        if url.endswith("/question/getExamQuestionInfo"):
            qid = data["questionId"]
            question = dict(QUESTIONS[qid])
            if self.submitted:
                chosen = self.answers.get(qid, "")
                expected = ANSWER_SEPARATOR_CHOICE.join(str(item) for item in CORRECT[qid])
                question["optionVos"] = [
                    {**option, "isCorrect": 1 if option["id"] in CORRECT[qid] else 0}
                    for option in question["optionVos"]
                ]
                question["userAnswerVo"] = [
                    {"answer": chosen, "isCorrect": 1 if chosen == expected else 0},
                ]
                question["analysisVo"] = {"content": "官方解析"}
            return {"code": 0, "data": question}
        raise AssertionError(f"unexpected exam url {url}")

    def ai_exam_submit(self, url, data):
        self.calls.append(("submit", url, dict(data)))
        self.submitted = True

    def close(self):
        self.closed += 1

    # -- 断言辅助 -------------------------------------------------------
    def called_urls(self):
        return [call[1] for call in self.calls]


@pytest.fixture(autouse=True)
def _clean_state():
    service._ACTIVE_ROUNDS.clear()
    service._MASTERY_CACHE.clear()
    yield
    service._ACTIVE_ROUNDS.clear()
    service._MASTERY_CACHE.clear()


def _wire(monkeypatch, session, points=None):
    monkeypatch.setattr(service, "_open_session", lambda key: (session, COURSE))
    monkeypatch.setattr(
        service, "_knowledge_points",
        lambda session, course_id, class_id: points or [{
            "knowledge_id": KNOWLEDGE, "name": "知识点甲", "theme": "主题一",
            "study_progress": 80, "free_exam": False,
        }],
    )
    return session


def test_catalog_reads_mastery_without_creating_a_paper(monkeypatch):
    session = _wire(monkeypatch, FakeSession(mastery=66))
    catalog = service.read_catalog("k" * 64)

    assert catalog["knowledge"][0]["mastery"] == 66
    assert catalog["knowledge"][0]["band"] == "mid"
    assert catalog["pending_count"] == 1
    assert catalog["average_mastery"] == 66
    # 只读：除了掌握度统计，没有建卷、没有开卷。
    assert [url for url in session.called_urls()] == [
        "https://kg-ai-run.example/run/gateway/t/stu/mastery-statistics/get-knowledge-mastery-stat",
    ]
    assert session.closed == 1


def test_round_lifecycle_saves_string_answers_and_submits_official_body(monkeypatch):
    session = _wire(monkeypatch, FakeSession(mastery=40))
    round_ = service.start_round("k" * 64, KNOWLEDGE)

    assert round_["exam_test_id"] == 4263949
    assert round_["question_num"] == 2
    assert session.called_urls()[0].startswith("https://kg-ai-run.example/run/gateway/t/stu/")
    assert "https://exam.example/gateway/t/v1/exam/user/openExam" in session.called_urls()

    service.save_answer("k" * 64, KNOWLEDGE, "939136618", 671372794)
    service.save_answer("k" * 64, KNOWLEDGE, "939136619", [671372795, 671372796])
    saved = [call for call in session.calls if call[1].endswith("/answer/saveAnswer")]
    assert [call[2]["answer"] for call in saved] == ["671372794", "671372795#@#671372796"]

    result = service.submit_round("k" * 64, KNOWLEDGE)
    submit = next(call for call in session.calls if call[0] == "submit")
    assert submit[1] == "https://exam.example/gateway/t/v1/exam/user/submit"
    assert submit[2] == {
        "examTestId": 4263949, "courseId": 2095430049486426112, "courseType": 8,
        "examPaperId": 454449917, "aiKnlowledgeId": 1853343377786015744,
    }
    assert result["submitted"] is True
    assert result["round_score"] == {"correct": 1, "total": 2, "percent": 50}
    assert result["graded"][0]["isCorrect"] is True
    assert result["graded"][1]["isCorrect"] is False
    assert result["graded"][1]["correctTexts"] == ["甲"]
    assert result["graded"][0]["analysis"] == "官方解析"
    assert result["mastery_after"]["mastery"] == 40
    assert result["next_round_hint"] == "practice_more"
    assert service.active_round("k" * 64, KNOWLEDGE) is None


def test_discard_only_drops_local_state(monkeypatch):
    session = _wire(monkeypatch, FakeSession())
    service.start_round("k" * 64, KNOWLEDGE)
    before = len(session.calls)

    assert service.discard_round("k" * 64, KNOWLEDGE)["discarded"] is True
    assert len(session.calls) == before, "放弃本轮不该向服务端发任何请求"
    assert service.active_round("k" * 64, KNOWLEDGE) is None


def test_active_round_restores_picker_state(monkeypatch):
    _wire(monkeypatch, FakeSession())
    service.start_round("k" * 64, KNOWLEDGE)
    service.save_answer("k" * 64, KNOWLEDGE, "939136619", [671372795, 671372796])

    active = service.active_round("k" * 64, KNOWLEDGE)
    assert active["answered"] == 1
    assert active["draft"] == {"939136619": [671372795, 671372796]}
    assert active["answers"] == {"939136619": "671372795#@#671372796"}


def test_unknown_knowledge_is_rejected_before_any_request(monkeypatch):
    session = _wire(monkeypatch, FakeSession())
    service.start_round("k" * 64, KNOWLEDGE)

    with pytest.raises(service.MasteryError) as raised:
        service.save_answer("k" * 64, KNOWLEDGE, "1", 671372791)
    assert raised.value.code == "QUESTION_NOT_IN_ROUND"
    assert not [call for call in session.calls if call[1].endswith("/answer/saveAnswer")]



def test_submit_readback_failure_does_not_post_twice(monkeypatch):
    session = _wire(monkeypatch, FakeSession())
    service.start_round("k" * 64, KNOWLEDGE)
    service.save_answer("k" * 64, KNOWLEDGE, "939136618", 671372794)
    original = session.ai_exam_query
    fail_once = {"yes": True}

    def flaky_read(url, data, method="POST"):
        if session.submitted and url.endswith("/question/getExamQuestionInfo") and fail_once["yes"]:
            fail_once["yes"] = False
            raise ConnectionError("readback dropped")
        return original(url, data, method=method)

    monkeypatch.setattr(session, "ai_exam_query", flaky_read)
    partial = service.submit_round("k" * 64, KNOWLEDGE)
    assert partial["submitted"] is True
    assert partial["grading_pending"] is True
    assert partial["verification_pending"] is True
    assert partial["round_score"] == {"correct": None, "total": 2, "percent": None}
    assert service.active_round("k" * 64, KNOWLEDGE)["submission_state"] == "submitted"

    confirmed = service.submit_round("k" * 64, KNOWLEDGE)
    assert confirmed["grading_pending"] is False
    assert confirmed["round_score"]["percent"] == 50
    assert len([call for call in session.calls if call[0] == "submit"]) == 1
    assert service.active_round("k" * 64, KNOWLEDGE) is None


def test_empty_grading_reply_never_becomes_zero_percent(monkeypatch):
    session = _wire(monkeypatch, FakeSession())
    service.start_round("k" * 64, KNOWLEDGE)
    original = session.ai_exam_query

    def missing_one(url, data, method="POST"):
        if session.submitted and url.endswith("/question/getExamQuestionInfo") and data["questionId"] == 939136619:
            return {"code": 0, "data": dict(QUESTIONS[939136619])}
        return original(url, data, method=method)

    monkeypatch.setattr(session, "ai_exam_query", missing_one)
    partial = service.submit_round("k" * 64, KNOWLEDGE)
    assert partial["round_score"]["correct"] is None
    assert partial["round_score"]["total"] == 2
    assert partial["round_score"]["percent"] is None
    assert partial["grading_pending"] is True
    assert len(partial["graded"]) == 1
    assert len([call for call in session.calls if call[0] == "submit"]) == 1


def test_timeout_after_server_acceptance_only_checks_status(monkeypatch):
    session = _wire(monkeypatch, FakeSession())
    service.start_round("k" * 64, KNOWLEDGE)
    original_submit = session.ai_exam_submit
    original_query = session.ai_exam_query

    def accepted_but_timeout(url, data):
        original_submit(url, data)
        raise TimeoutError("response lost")

    def exam_status(url, data, method="POST"):
        if url.endswith("/exam/user/getExamTestUserInfo"):
            session.calls.append(("exam", url, dict(data), method))
            return {"code": 0, "data": {"examState": 6, "submitTime": "2026-11-22T00:00:00"}}
        return original_query(url, data, method=method)

    monkeypatch.setattr(session, "ai_exam_submit", accepted_but_timeout)
    monkeypatch.setattr(session, "ai_exam_query", exam_status)
    with pytest.raises(service.MasteryError) as error:
        service.submit_round("k" * 64, KNOWLEDGE)
    assert error.value.code == "SUBMIT_STATUS_UNKNOWN"
    assert service.active_round("k" * 64, KNOWLEDGE)["submission_state"] == "unknown"

    checked = service.submit_round("k" * 64, KNOWLEDGE)
    assert checked["submitted"] is True
    assert checked["grading_pending"] is False
    assert len([call for call in session.calls if call[0] == "submit"]) == 1
    assert any(call[1].endswith("/exam/user/getExamTestUserInfo") for call in session.calls)


def test_unknown_submission_never_reposts_when_not_confirmed(monkeypatch):
    session = _wire(monkeypatch, FakeSession())
    service.start_round("k" * 64, KNOWLEDGE)
    original_query = session.ai_exam_query

    def timeout_without_ack(url, data):
        session.calls.append(("submit", url, dict(data)))
        raise TimeoutError("no ack")

    def not_yet_submitted(url, data, method="POST"):
        if url.endswith("/exam/user/getExamTestUserInfo"):
            return {"code": 0, "data": {"examState": 3, "submitTime": None}}
        return original_query(url, data, method=method)

    monkeypatch.setattr(session, "ai_exam_submit", timeout_without_ack)
    monkeypatch.setattr(session, "ai_exam_query", not_yet_submitted)
    with pytest.raises(service.MasteryError):
        service.submit_round("k" * 64, KNOWLEDGE)
    with pytest.raises(service.MasteryError) as error:
        service.submit_round("k" * 64, KNOWLEDGE)
    assert error.value.code == "SUBMIT_STATUS_UNKNOWN"
    assert len([call for call in session.calls if call[0] == "submit"]) == 1
    with pytest.raises(service.MasteryError) as saved:
        service.save_answer("k" * 64, KNOWLEDGE, "939136618", 671372794)
    assert saved.value.code == "ROUND_ALREADY_SUBMITTED"
