"""Mastery homework round against a fake Zhihuishu gateway.

The fake replays the captured envelopes plus the packaged runtime behaviour
(``zhs/ai/homework.py``): sheet part ``"知识点练习默认部分"``, ``examType: 5``,
``limitTime: 0``, string answers joined with ``#@#``, an empty-body ``submit``
carrying ``courseType: 8``, and grading that only exists after submit.

Proven here:

* request order is ``questions-paper -> openExam -> getExamTestUserInfo ->
  getExamSheetInfo -> getExamQuestionInfo x N -> saveAnswer x N -> submit ->
  getExamSheetInfo -> getExamQuestionInfo x N -> questions-paper``;
* ``submit`` is the scoring trigger and its body decrypts to the official shape;
* correctness is read back from ``userAnswerVo[].isCorrect`` after submit;
* ``highMasteryScore`` is the historical best, ``roundScore`` is this round --
  never mixed;
* re-reading mastery opens a new paper, so 重做 never reuses an ``examTestId``.
"""
import json

import pytest

from studyflow.platforms.zhidao.zhs_mastery import (
    COURSE_TYPE_AI_HOMEWORK,
    EXAM_TYPE_PRACTICE,
    HOMEWORK_THRESHOLD_DEFAULT,
    ZhsApiError,
    ZhsMasteryClient,
    answer_shape,
    decode_answer,
    format_answer,
    parse_question_result,
    parse_sheet_progress,
    resolve_option,
    unseal_payload,
)

from zhs_fake_gateway import PART_NAME, QUESTION_1, QUESTION_2, FakeGateway
from zhs_mastery_vectors import CKEY_EXAM, CKEY_KG_AI

ALL_CORRECT = {939136618: 671372794, 939136619: [671372795, 671372796, 671372797, 671372798, 671372799]}


def test_round_is_create_answer_submit_grade():
    gateway = FakeGateway()
    client = ZhsMasteryClient(gateway)

    result = client.practice_round(
        sc_map_id="2095430049486426112",
        course_id="2095430049486426112",
        class_id="339597",
        knowledge_id="1853343377786015744",
        answers=ALL_CORRECT,
        delay=0,
    )

    assert gateway.urls() == [
        "https://kg-ai-run.zhihuishu.com/run/gateway/t/stu/exam/questions-paper",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/exam/user/openExam",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/exam/user/getExamTestUserInfo",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/exam/user/getExamSheetInfo",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/question/getExamQuestionInfo",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/question/getExamQuestionInfo",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/answer/saveAnswer",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/answer/saveAnswer",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/exam/user/submit",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/exam/user/getExamSheetInfo",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/question/getExamQuestionInfo",
        "https://studentexamtest.zhihuishu.com/gateway/t/v1/question/getExamQuestionInfo",
        "https://kg-ai-run.zhihuishu.com/run/gateway/t/stu/exam/questions-paper",
    ]

    assert result["examType"] == EXAM_TYPE_PRACTICE
    assert result["limitTime"] == 0
    assert result["submitted"] is True
    assert result["roundScore"] == {"correct": 2, "total": 2, "percent": 100}
    assert [item["isCorrect"] for item in result["graded"]] == [True, True]
    assert result["progressAfter"].complete is True
    assert result["masteryAfter"]["highScore"] == 100


def test_submit_body_matches_packaged_runtime():
    gateway = FakeGateway()
    client = ZhsMasteryClient(gateway)
    client.practice_round(
        sc_map_id="2095430049486426112", course_id="2095430049486426112",
        class_id="339597", knowledge_id="1853343377786015744",
        answers={939136618: 671372794}, delay=0, verify=False,
    )
    submit = next(c for c in gateway.calls if c["url"].endswith("/exam/user/submit"))
    plain = json.loads(unseal_payload(submit["data"]["secretStr"], CKEY_EXAM))
    assert plain == {
        "examTestId": 4263949,
        "courseId": 2095430049486426112,
        "courseType": COURSE_TYPE_AI_HOMEWORK,
        "examPaperId": 454449917,
        "aiKnlowledgeId": 1853343377786015744,
    }
    assert submit["headers"]["Content-Type"] == "application/x-www-form-urlencoded"


def test_save_answer_sends_joined_string_not_array():
    gateway = FakeGateway()
    client = ZhsMasteryClient(gateway)
    client.practice_round(
        sc_map_id="2095430049486426112", course_id="2095430049486426112",
        class_id="339597", knowledge_id="1853343377786015744",
        answers={939136619: [671372795, 671372796]}, delay=0, verify=False,
    )
    saves = [c for c in gateway.calls if c["url"].endswith("/answer/saveAnswer")]
    plain = json.loads(unseal_payload(saves[0]["data"]["secretStr"], CKEY_EXAM))
    assert plain == {
        "recruitId": "2095430049486426112",
        "examTestId": "4263949",
        "examPaperId": 454449917,
        "questionId": 939136619,
        "dataVos": None,
        "answer": "671372795#@#671372796",
    }


def test_format_answer_uses_slash_for_fill_in_the_blank():
    assert format_answer([671372794], 1) == "671372794"
    assert format_answer([1, 2], 2) == "1#@#2"
    assert format_answer(["生产力", "生产关系"], 3) == "生产力/生产关系"
    assert format_answer("新时代", 14) == "新时代"
    assert format_answer(None, 1) == ""


def test_decode_answer_restores_picker_state():
    # 刷新页面后恢复未提交的一轮：线上字符串要还原成界面能回填的形状。
    assert decode_answer("671372794", 1) == 671372794
    assert decode_answer("671372795#@#671372796", 2) == [671372795, 671372796]
    assert decode_answer("生产力/生产关系", 3) == ["生产力", "生产关系"]
    assert decode_answer("", 1) is None
    assert decode_answer(None, 2) is None
    # 往返一致：存进去再读回来，选项/文本不变。
    assert decode_answer(format_answer([671372797, 671372798], 2), 2) == [671372797, 671372798]
    assert decode_answer(format_answer("新时代", 14), 14) == "新时代"
    assert decode_answer(format_answer(["甲", "乙"], 3), 3) == ["甲", "乙"]


def test_parse_question_result_before_and_after_submit():
    before = parse_question_result(QUESTION_1)
    assert before["graded"] is False
    assert before["isCorrect"] is False
    assert before["correctOptionIds"] == []

    gateway = FakeGateway()
    client = ZhsMasteryClient(gateway)
    result = client.practice_round(
        sc_map_id="1", course_id="1", class_id="1", knowledge_id="1",
        answers={939136618: 671372791, 939136619: ALL_CORRECT[939136619]},
        delay=0, verify=False,
    )
    wrong = result["graded"][0]
    assert wrong["isCorrect"] is False
    assert wrong["correctOptionIds"] == [671372794]
    assert wrong["analysis"]
    assert result["graded"][1]["isCorrect"] is True
    assert result["roundScore"] == {"correct": 1, "total": 2, "percent": 50}


def test_verify_opens_a_second_paper_so_redo_never_reuses_ids():
    gateway = FakeGateway()
    client = ZhsMasteryClient(gateway)
    result = client.practice_round(
        sc_map_id="1", course_id="1", class_id="1", knowledge_id="1",
        answers={939136618: 671372794}, delay=0,
    )
    assert result["examTestId"] == 4263949
    assert result["nextRound"]["examTestId"] == 4263950
    assert result["nextRound"]["examPaperId"] == 454449918
    assert result["examTestId"] != result["nextRound"]["examTestId"]


def test_read_only_round_writes_nothing():
    gateway = FakeGateway()
    client = ZhsMasteryClient(gateway)
    result = client.practice_round(
        sc_map_id="1", course_id="1", class_id="1", knowledge_id="1", delay=0,
    )
    assert result["answers"] == []
    assert result["submitted"] is False
    assert result["graded"] == []
    assert "masteryAfter" not in result
    assert len(gateway.papers) == 1
    assert not any(url.endswith("/saveAnswer") or url.endswith("/submit") for url in gateway.urls())


def test_answerer_callback_and_skip_sentinel():
    gateway = FakeGateway()
    client = ZhsMasteryClient(gateway)

    def only_single_choice(question, progress):
        if answer_shape(question) != "single":
            return client.SKIP
        return resolve_option(question, "新时代")

    result = client.practice_round(
        sc_map_id="1", course_id="1", class_id="1", knowledge_id="1",
        answerer=only_single_choice, delay=0, verify=False,
    )
    assert result["answers"] == [{"questionId": 939136618, "answer": "671372794", "ok": True}]
    assert result["submitted"] is True
    assert result["progressAfter"].answer_count == 1
    assert result["progressAfter"].complete is False
    assert result["roundScore"]["correct"] == 1
    assert result["roundScore"]["total"] == 2


def test_question_request_carries_date_but_open_exam_does_not():
    gateway = FakeGateway()
    client = ZhsMasteryClient(gateway)
    client.practice_round(
        sc_map_id="1", course_id="1", class_id="1", knowledge_id="1", delay=0,
    )
    open_exam = next(c for c in gateway.calls if c["url"].endswith("/openExam"))
    assert "date" not in open_exam["data"]
    open_plain = json.loads(unseal_payload(open_exam["data"]["secretStr"], CKEY_EXAM))
    assert open_plain == {"examTestId": 4263949, "examPaperId": 454449917, "courseId": "1"}

    paper = next(c for c in gateway.calls if c["url"].endswith("/questions-paper"))
    assert isinstance(paper["json"]["date"], int)
    assert unseal_payload(paper["json"]["secretStr"], CKEY_KG_AI).startswith('{"scMapId":')
    assert "XQJZXHIZ" in paper["headers"]


def test_sheet_progress_reads_part_name_and_answer_state():
    sheet = {
        "partSheetVos": [{
            "id": 6789354,
            "name": PART_NAME,
            "questionSheetVos": [
                {"questionId": 1, "answerState": 1},
                {"questionId": 2, "answerState": 2},
                {"questionId": 3, "answerState": None},
            ],
        }],
    }
    progress = parse_sheet_progress(sheet)
    assert progress.question_count == 3
    assert progress.answer_count == 1
    assert [row["questionId"] for row in progress.pending] == [1, 3]
    assert progress.complete is False
    assert progress.ratio == pytest.approx(1 / 3)


def test_resolve_option_rejects_ambiguous_and_missing():
    with pytest.raises(KeyError):
        resolve_option(QUESTION_1, "新")
    with pytest.raises(KeyError):
        resolve_option(QUESTION_1, "不存在的选项")
    assert resolve_option(QUESTION_1, "新时代") == 671372794
    assert resolve_option(QUESTION_2, "共同富裕", "伟大复兴") == [671372797, 671372798]
    assert answer_shape(QUESTION_1) == "single"
    assert answer_shape(QUESTION_2) == "multi"
    assert answer_shape({"questionType": 3, "optionVos": []}) == "text"
    assert answer_shape({"questionType": 14, "optionVos": [{"id": 1, "content": "对"}]}) == "single"


def test_save_failure_is_recorded_and_blocks_submit():
    gateway = FakeGateway(fail_save_code=2046)
    client = ZhsMasteryClient(gateway)
    result = client.practice_round(
        sc_map_id="1", course_id="1", class_id="1", knowledge_id="1",
        answers={939136618: None}, delay=0, verify=False, tolerate_errors=True,
    )
    assert result["answers"][0]["ok"] is False
    assert result["answers"][0]["code"] == 2046
    assert result["submitted"] is False
    assert "masteryAfter" not in result


def test_save_failure_raises_without_tolerate_errors():
    gateway = FakeGateway(fail_save_code=2046)
    client = ZhsMasteryClient(gateway)
    with pytest.raises(ZhsApiError) as error:
        client.practice_round(
            sc_map_id="1", course_id="1", class_id="1", knowledge_id="1",
            answers={939136618: None}, delay=0, verify=False,
        )
    assert error.value.code == 2046


def test_submit_failure_raises_and_marks_not_submitted():
    gateway = FakeGateway(fail_submit_code=5001)
    client = ZhsMasteryClient(gateway)
    with pytest.raises(ZhsApiError) as error:
        client.practice_round(
            sc_map_id="1", course_id="1", class_id="1", knowledge_id="1",
            answers={939136618: 671372794}, delay=0, verify=False,
        )
    assert error.value.code == 5001
    assert gateway.submitted is False


def test_threshold_default_is_ninety():
    assert HOMEWORK_THRESHOLD_DEFAULT == 90
