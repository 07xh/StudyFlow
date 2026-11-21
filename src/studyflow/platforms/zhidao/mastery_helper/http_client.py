"""Pure HTTP Zhidao mastery protocol; shared login, no browser or Playwright.

Wire format for the read endpoints and saveAnswer was validated against a
user-supplied HAR. The final submit call follows the upstream ZHS AI-exam
contract and must be independently verified with a real session.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

BASE_EXAM = "https://studentexamtest.zhihuishu.com"
BASE_AI = "https://kg-ai-run.zhihuishu.com"


class MasteryProtocolError(RuntimeError):
    pass


def _positive_id(value: Any, name: str) -> int:
    if type(value) is int and 0 < value < 2**63:
        return value
    if isinstance(value, str) and value.isascii() and value.isdigit() and 0 < int(value) < 2**63:
        return int(value)
    raise MasteryProtocolError("INVALID_" + name.upper())


def _data(response: Any, expected: int) -> Any:
    if not isinstance(response, dict) or response.get("code") != expected:
        raise MasteryProtocolError("MASTERY_RESPONSE_UNVERIFIED")
    if "data" not in response:
        raise MasteryProtocolError("MASTERY_RESPONSE_MISSING_DATA")
    return response["data"]


@dataclass(frozen=True)
class Paper:
    course_id: int
    class_id: int
    knowledge_id: int
    exam_test_id: int
    paper_id: int
    mastery: float | None
    question_count: int | None

    @classmethod
    def parse(cls, course_id: int, class_id: int, knowledge_id: int, data: Any) -> "Paper":
        if not isinstance(data, dict):
            raise MasteryProtocolError("MASTERY_PAPER_INVALID")
        score = data.get("highMasteryScore")
        if isinstance(score, (int, float)) and not isinstance(score, bool) and 0 <= score <= 100:
            mastery: float | None = float(score)
        else:
            mastery = None
        num = data.get("questionNum")
        return cls(course_id, class_id, knowledge_id,
                   _positive_id(data.get("examTestId"), "exam_test_id"),
                   _positive_id(data.get("paperId"), "paper_id"),
                   mastery, num if type(num) is int and num >= 0 else None)


class MasteryHttpClient:
    """Use the current ZHS authenticated session; do not persist or export cookies."""

    def __init__(self, session: Any):
        self.session = session
        # ZHS provides the same AES-128-CBC primitive used by the captured
        # platform requests; we do not copy secrets, cookies or private keys.
        from zhs.crypto import Cipher
        self._exam_cipher = Cipher(session.crypto.key_bytes("exam_key"), session.crypto.key_bytes("iv"))
        self._ai_cipher = Cipher(session.crypto.key_bytes("ai_key"), session.crypto.key_bytes("iv"))

    @staticmethod
    def _timestamp() -> int:
        return int(time.time() * 1000)

    def _secure(self, payload: dict[str, Any], *, family: str = "exam",
                timestamp: bool = True) -> dict[str, Any]:
        cipher = self._exam_cipher if family == "exam" else self._ai_cipher
        stamp = self._timestamp()
        data = dict(payload)
        if family == "ai":
            data["dateFormate"] = stamp
        params = {"secretStr": cipher.encrypt(json.dumps(data, ensure_ascii=False))}
        if timestamp:
            params["date"] = stamp
        return params

    def _query(self, path: str, data: dict[str, Any], *,
               method: str = "GET", family: str = "exam",
               timestamp: bool = True, json_body: bool = False) -> Any:
        base = BASE_AI if family == "ai" else BASE_EXAM
        params = self._secure(data, family=family, timestamp=timestamp)
        origin = ("https://ai-smart-course-student-pro.zhihuishu.com"
                  if family == "ai" else "https://studentexamcomh5.zhihuishu.com")
        client = self.session._get_client()
        request_kwargs = {
            "headers": {"Origin": origin, "Referer": origin + "/"},
            "timeout": 30.0,
        }
        if method == "GET":
            request_kwargs["params"] = params
        elif json_body:
            request_kwargs["json"] = params
        else:
            request_kwargs["data"] = params
        response = client.request(method, base + path, **request_kwargs)
        response.raise_for_status()
        result = response.json()
        return _data(result, 200 if family == "ai" else 0)

    def paper(self, course_id: int, class_id: int, knowledge_id: int) -> Paper:
        for name, value in [("course_id",course_id),("class_id",class_id),("knowledge_id",knowledge_id)]:
            _positive_id(value,name)
        payload = {"scMapId": str(course_id), "courseId": str(course_id),
                   "classId": str(class_id), "knowledgeId": str(knowledge_id)}
        body = self._query("/run/gateway/t/stu/exam/questions-paper", payload,
                           method="POST", family="ai", json_body=True)
        return Paper.parse(course_id, class_id, knowledge_id, body)

    def open_exam(self, paper: Paper) -> bool:
        payload = {"examTestId": paper.exam_test_id,
                   "examPaperId": paper.paper_id, "courseId": str(paper.course_id)}
        return self._query("/gateway/t/v1/exam/user/openExam", payload,
                           method="POST", timestamp=False) is True

    def sheet(self, paper: Paper) -> dict[str, Any]:
        payload = {"examTestId": str(paper.exam_test_id),
                   "examPaperId": str(paper.paper_id)}
        body = self._query("/gateway/t/v1/exam/user/getExamSheetInfo", payload)
        if not isinstance(body, dict) or not isinstance(body.get("partSheetVos"), list):
            raise MasteryProtocolError("MASTERY_SHEET_INVALID")
        return body

    def exam_info(self, paper: Paper) -> dict[str, Any]:
        body = self._query("/gateway/t/v1/exam/user/getExamTestUserInfo",
                           {"examTestId": str(paper.exam_test_id),
                            "examPaperId": str(paper.paper_id)})
        if not isinstance(body, dict):
            raise MasteryProtocolError("MASTERY_EXAM_INFO_INVALID")
        return {k: body.get(k) for k in ("examState","examType","questionCount",
                "isShowScore","isAllowShowDetail","isLookAnswer")}

    def question(self, paper: Paper, question_id: int, version: int) -> dict[str, Any]:
        qid = _positive_id(question_id, "question_id")
        if type(version) is not int or version < 0:
            raise MasteryProtocolError("INVALID_VERSION")
        data = {"examTestId": str(paper.exam_test_id), "examPaperId": paper.paper_id,
                "questionId": qid, "version": version}
        body = self._query("/gateway/t/v1/question/getExamQuestionInfo", data)
        if not isinstance(body, dict) or body.get("id") != qid:
            raise MasteryProtocolError("MASTERY_QUESTION_INVALID")
        return body

    def save_answer(self, paper: Paper, question_id: int, answer: str) -> bool:
        _positive_id(question_id, "question_id")
        if not isinstance(answer, str) or not answer or len(answer) > 2048:
            raise MasteryProtocolError("MASTERY_ANSWER_INVALID")
        payload = {"recruitId": str(paper.course_id), "examTestId": str(paper.exam_test_id),
                   "examPaperId": paper.paper_id, "questionId": question_id,
                   "dataVos": None, "answer": answer}
        result = self._query("/gateway/t/v1/answer/saveAnswer", payload, method="POST")
        return result is True

    def submit_once(self, paper: Paper) -> None:
        """Official ZHS AI-exam submit contract; HTTP success is *not* a grade."""
        data = {"examTestId": paper.exam_test_id,
                "recruitId": paper.course_id,
                "examPaperId": paper.paper_id}
        # The upstream implementation uses exam_key, dateFormate and a POST
        # without response content. Do not retry when the result is uncertain.
        if not self.session.ai_exam_submit(
                BASE_EXAM + "/gateway/t/v1/exam/user/submit", data):
            raise MasteryProtocolError("MASTERY_SUBMIT_UNCONFIRMED")


def question_ids(sheet: dict[str, Any]) -> list[tuple[int, int]]:
    """Parse every part and preserve the actual server-assigned question IDs."""
    rows: list[tuple[int, int]] = []
    for part in sheet.get("partSheetVos", []):
        if not isinstance(part, dict):
            raise MasteryProtocolError("MASTERY_SHEET_INVALID")
        for item in part.get("questionSheetVos") or []:
            if not isinstance(item, dict):
                raise MasteryProtocolError("MASTERY_SHEET_INVALID")
            version = item.get("version")
            if type(version) is not int or version < 0:
                raise MasteryProtocolError("MASTERY_SHEET_INVALID")
            rows.append((_positive_id(item.get("questionId"), "question_id"), version))
    if not rows or len(rows) != len(set(rows)):
        raise MasteryProtocolError("MASTERY_SHEET_EMPTY_OR_DUPLICATED")
    return rows
