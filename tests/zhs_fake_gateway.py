"""A stateful stand-in for the Zhihuishu mastery homework gateway.

Envelopes are copied from the real capture plus the packaged runtime
(``zhs/ai/homework.py`` in zhs 0.1.5):

* sheet part name ``"知识点练习默认部分"``, ``examType: 5``, ``limitTime: 0``;
* ``openExam`` takes ``{examTestId, examPaperId, courseId}``;
* ``saveAnswer`` takes a **string** answer joined with ``#@#``;
* ``submit`` takes ``{examTestId, courseId, courseType: 8, examPaperId,
  aiKnlowledgeId}`` and answers with an **empty body**;
* grading only exists after submit: ``userAnswerVo[].isCorrect`` and
  ``optionVos[].isCorrect`` are null before it.

Shared by ``tests/test_zhs_practice.py`` and ``scripts/verify_zhs_mastery.py``
so the offline proof runs with or without pytest.
"""
from __future__ import annotations

import json

from studyflow.platforms.zhidao.zhs_mastery import (
    ANSWER_SEPARATOR_CHOICE,
    COURSE_TYPE_AI_HOMEWORK,
    EXAM_TYPE_PRACTICE,
    unseal_payload,
)

from zhs_mastery_vectors import CKEY_EXAM, SL_EXAM, SL_KG_AI

PART_NAME = "知识点练习默认部分"

QUESTION_1 = {
    "id": 939136618,
    "content": "(       )是我们理解当前所处历史方位的关键词。",
    "questionType": 1,
    "questionTypeName": "单选题",
    "result": None,
    "childQuestionVos": None,
    "userAnswerVo": None,
    "analysisVo": None,
    "optionVos": [
        {"id": 671372791, "content": "新思想", "isCorrect": None, "sort": 1},
        {"id": 671372792, "content": "新举措", "isCorrect": None, "sort": 2},
        {"id": 671372793, "content": "新格局", "isCorrect": None, "sort": 3},
        {"id": 671372794, "content": "新时代", "isCorrect": None, "sort": 4},
    ],
    "dataFileVos": None,
    "codeQuestionDetailDto": None,
    "examTitle": None,
    "examDesc": None,
    "readOverFileVos": None,
    "studentRemarkList": None,
    "teacherRemarkList": None,
}

QUESTION_2 = {
    "id": 939136619,
    "content": "大学生需要对新时代有深入的了解和真切的感悟,这个新时代具体是(       )。",
    "questionType": 2,
    "questionTypeName": "多选题",
    "result": None,
    "childQuestionVos": None,
    "userAnswerVo": None,
    "analysisVo": None,
    "optionVos": [
        {"id": 671372795, "content": "是承前启后、继往开来、在新的历史条件下继续夺取中国特色社会主义伟大胜利的时代", "isCorrect": None, "sort": 1},
        {"id": 671372796, "content": "是决胜全面建成小康社会、进而全面建设社会主义现代化强国的时代", "isCorrect": None, "sort": 2},
        {"id": 671372797, "content": "是全国各族人民团结奋斗、不断创造美好生活、逐步实现全体人民共同富裕的时代", "isCorrect": None, "sort": 3},
        {"id": 671372798, "content": "是全体中华儿女勠力同心、奋力实现中华民族伟大复兴中国梦的时代", "isCorrect": None, "sort": 4},
        {"id": 671372799, "content": "是我国日益走近世界舞台中央、不断为人类做出更大贡献的时代", "isCorrect": None, "sort": 5},
    ],
    "dataFileVos": None,
    "codeQuestionDetailDto": None,
    "examTitle": None,
    "examDesc": None,
    "readOverFileVos": None,
    "studentRemarkList": None,
    "teacherRemarkList": None,
}

QUESTIONS = {939136618: QUESTION_1, 939136619: QUESTION_2}

# 官方答案（本卷）：单选"新时代"，多选全选。
CORRECT_OPTIONS = {
    939136618: [671372794],
    939136619: [671372795, 671372796, 671372797, 671372798, 671372799],
}


class FakeResponse:
    def __init__(self, payload, status=200, raw_text=None):
        self.status_code = status
        self._payload = payload
        self.text = raw_text if raw_text is not None else json.dumps(payload, ensure_ascii=False)
        self.headers = {"content-type": "application/json"}

    def json(self):
        if self._payload is None:
            raise ValueError("no json body")
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeCookies:
    def __init__(self):
        self._store = {}

    def set(self, name, value, domain=None):
        self._store[name] = value

    def get(self, name, default=None):
        return self._store.get(name, default)


class FakeGateway:
    """Answers like ``studentexamtest`` / ``kg-ai-run`` for one homework flow."""

    def __init__(self, mastery_before=0, mastery_after=100, fail_save_code=None,
                 fail_submit_code=None):
        self.calls: list[dict] = []
        self.papers: list[dict] = []
        self.answers: dict[int, str] = {}
        self.submitted = False
        self.mastery_scores = [mastery_before, mastery_after]
        self.fail_save_code = fail_save_code
        self.fail_submit_code = fail_submit_code
        self.key_calls = 0
        self.cookies = FakeCookies()
        self.headers: dict[str, str] = {}

    # -- requests -------------------------------------------------------
    def request(self, method, url, params=None, data=None, json=None, headers=None, timeout=None):
        self.calls.append({
            "method": method, "url": url, "params": dict(params or {}),
            "data": dict(data or {}), "json": json, "headers": dict(headers or {}),
        })
        return self._route(method, url, params, data, json)

    def get(self, url, params=None, timeout=None):
        return self.request("GET", url, params=params, timeout=timeout)

    def business_calls(self) -> list[dict]:
        return [call for call in self.calls if "/c/has" not in call["url"]]

    def urls(self) -> list[str]:
        return [call["url"].split("?")[0] for call in self.business_calls()]

    def _route(self, method, url, params, data, body):
        if "/app-commserv-user/c/has" in url:
            self.key_calls += 1
            secret = SL_KG_AI if self.key_calls == 1 else SL_EXAM
            return FakeResponse({"status": 200, "msg": "ok", "rt": {"sl": secret}})
        if url.endswith("/exam/questions-paper"):
            score = self.mastery_scores[min(len(self.papers), len(self.mastery_scores) - 1)]
            paper = {
                "masteryScore": score,
                "highMasteryScore": score,
                "masteryChange": 0,
                "examTestId": 4263949 + len(self.papers),
                "paperId": 454449917 + len(self.papers),
                "questionNum": len(QUESTIONS),
                "error": None,
            }
            self.papers.append(paper)
            self.answers = {}
            self.submitted = False
            return FakeResponse({"code": 200, "message": "OK", "data": paper, "traceId": "t"})
        if url.endswith("/exam/user/openExam"):
            return FakeResponse({"code": 0, "traceId": "t", "message": "success", "data": True})
        if url.endswith("/exam/user/getExamTestUserInfo"):
            paper = self.papers[-1]
            return FakeResponse({
                "code": 0, "traceId": "t", "message": "success",
                "data": {
                    "examTestId": paper["examTestId"],
                    "examPaperId": paper["paperId"],
                    "examState": 3,
                    "examType": EXAM_TYPE_PRACTICE,
                    "totalScore": None,
                    "questionCount": len(QUESTIONS),
                    "score": None,
                    "limitTime": 0,
                    "duration": 0,
                    "isObjective": True,
                    "isShowScore": 1,
                    "isLookAnswer": 1,
                    "submitTime": None,
                },
            })
        if url.endswith("/exam/user/getExamSheetInfo"):
            rows = []
            for index, question_id in enumerate(QUESTIONS, start=1):
                rows.append({
                    "parentPartId": 6789354,
                    "questionType": QUESTIONS[question_id]["questionType"],
                    "parentId": None,
                    "parentQuestionType": None,
                    "parentVersion": None,
                    "questionId": question_id,
                    "version": 1,
                    "sort": str(index),
                    "correct": None,
                    "score": 0.00,
                    "answerState": 2 if question_id in self.answers else 1,
                })
            return FakeResponse({
                "code": 0, "traceId": "t", "message": "success",
                "data": {
                    "partSheetVos": [{
                        "id": 6789354, "name": PART_NAME, "questionCount": 0,
                        "totalScore": None, "partExplanation": None, "sort": 1,
                        "questionSheetVos": rows,
                    }],
                    "answerCount": len(self.answers),
                    "questionCount": len(QUESTIONS),
                },
            })
        if url.endswith("/question/getExamQuestionInfo"):
            plain = json.loads(unseal_payload(params["secretStr"], CKEY_EXAM))
            question_id = int(plain["questionId"])
            return FakeResponse({
                "code": 0, "traceId": "t", "message": "success",
                "data": self._question_payload(question_id),
            })
        if url.endswith("/answer/saveAnswer"):
            if self.fail_save_code is not None:
                return FakeResponse({"code": self.fail_save_code, "message": "答案不能为空", "data": None})
            plain = json.loads(unseal_payload(data["secretStr"], CKEY_EXAM))
            self.answers[int(plain["questionId"])] = plain["answer"]
            return FakeResponse({"code": 0, "traceId": "t", "message": "success", "data": True})
        if url.endswith("/exam/user/submit"):
            if self.fail_submit_code is not None:
                return FakeResponse({"code": self.fail_submit_code, "message": "提交失败", "data": None})
            plain = json.loads(unseal_payload(data["secretStr"], CKEY_EXAM))
            assert plain["courseType"] == COURSE_TYPE_AI_HOMEWORK, plain
            self.submitted = True
            # 真实接口无返回体。
            return FakeResponse(None, raw_text="")
        if url.endswith("/exam/user/updateUserUsedTime"):
            return FakeResponse({"code": 0, "traceId": "t", "message": "success", "data": True})
        raise AssertionError(f"unexpected url {url}")

    def _question_payload(self, question_id: int) -> dict:
        template = QUESTIONS[question_id]
        payload = json.loads(json.dumps(template))
        if not self.submitted:
            return payload
        answer = self.answers.get(question_id, "")
        picked = [int(part) for part in answer.split(ANSWER_SEPARATOR_CHOICE) if part.strip().isdigit()]
        correct = CORRECT_OPTIONS[question_id]
        is_correct = sorted(picked) == sorted(correct)
        payload["userAnswerVo"] = [{
            "isCorrect": 1 if is_correct else 0,
            "answer": ANSWER_SEPARATOR_CHOICE.join(str(item) for item in picked),
        }]
        payload["optionVos"] = [
            {**option, "isCorrect": 1 if option["id"] in correct else 0}
            for option in payload["optionVos"]
        ]
        payload["analysisVo"] = {"analysis": f"{question_id} 的官方解析"}
        return payload
