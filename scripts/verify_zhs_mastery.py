"""Verify the Zhihuishu secretStr implementation against the captured HAR.

Runs on a stock Python (no requests / cryptography / pytest needed):

    python scripts/verify_zhs_mastery.py

Exits 0 only when every captured body re-seals to the exact bytes that left the
browser, and the key-service blobs decode with the embedded public exponent.
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from studyflow.platforms.zhidao.zhs_mastery import (  # noqa: E402
    MODULE_EXAM,
    answer_payload,
    exam_ref_payload,
    open_exam_payload,
    paper_payload,
    question_payload,
    rsa_public_decrypt,
    seal_payload,
    unseal_payload,
)
from zhs_mastery_vectors import (  # noqa: E402
    CKEY_EXAM,
    CKEY_KG_AI,
    HAR,
    KEY_BLOB_EXAM,
    KEY_BLOB_KG_AI,
    SL_EXAM,
    SL_KG_AI,
    XQJZXHIZ,
)

FAILURES: list[str] = []
CHECKS = 0


def check(label: str, actual: object, expected: object) -> None:
    global CHECKS
    CHECKS += 1
    if actual == expected:
        print(f"[PASS] {label}")
        return
    FAILURES.append(label)
    print(f"[FAIL] {label}\n       actual   = {actual!r}\n       expected = {expected!r}")


def main() -> int:
    def decode(sl: str) -> dict:
        return json.loads(rsa_public_decrypt(base64.b64decode(sl)).decode("utf-8"))

    check("key blob (module 6) decodes", decode(SL_KG_AI), KEY_BLOB_KG_AI)
    check("key blob (module 3) decodes", decode(SL_EXAM), KEY_BLOB_EXAM)

    for module, label, payload, expected in HAR:
        ckey = CKEY_EXAM if module == MODULE_EXAM else CKEY_KG_AI
        check(f"seal   {label}", seal_payload(payload, ckey), expected)
        check(f"unseal {label}", json.loads(unseal_payload(expected, ckey)), payload)

    check(
        "builder openExam -> wire",
        seal_payload(open_exam_payload(
            exam_test_id=4263949, exam_paper_id=454449917, course_id="2095430049486426112",
        ), CKEY_EXAM),
        HAR[0][3],
    )
    check(
        "builder exam_ref -> body",
        exam_ref_payload(exam_test_id=4263949, exam_paper_id="454449917"), HAR[1][2],
    )
    check(
        "builder question -> body",
        question_payload(exam_test_id="4263949", exam_paper_id="454449917",
                         question_id=939136618, version=1), HAR[2][2],
    )
    check(
        "builder saveAnswer -> body",
        answer_payload(recruit_id=2095430049486426112, exam_test_id=4263949,
                       exam_paper_id=454449917, question_id=939136618), HAR[3][2],
    )
    check(
        "builder questions-paper -> body",
        paper_payload(sc_map_id=2095430049486426112, course_id=2095430049486426112,
                      class_id=339597, knowledge_id=1853343377786015744,
                      date_formate=1795272661000), HAR[4][2],
    )
    check("XQJZXHIZ header token", seal_payload("", CKEY_KG_AI), XQJZXHIZ)

    # Wiring check: KeyRing drives the same seals through a stubbed transport.
    from studyflow.platforms.zhidao.zhs_mastery import KeyRing  # noqa: E402

    class _Response:
        status_code = 200
        headers = {"content-type": "application/json"}

        def __init__(self, body: dict) -> None:
            self._body = body

        def json(self) -> dict:
            return self._body

        def raise_for_status(self) -> None:
            return None

    class _Session:
        def __init__(self, body: dict) -> None:
            self._body = body
            self.calls: list = []

        def get(self, url, params=None, timeout=None, **kwargs):
            self.calls.append((url, params))
            return _Response(self._body)

    ring_session = _Session({"rt": {"sl": SL_EXAM}, "status": "200"})
    ring = KeyRing(ring_session, timeout=5)
    check("KeyRing cKey (module 3)", ring.ckey(MODULE_EXAM), CKEY_EXAM)
    check("KeyRing caches (one HTTP call)", len(ring_session.calls), 1)
    check("KeyRing seal -> wire", ring.seal({"examTestId": "4263949", "examPaperId": "454449917"},
                                            MODULE_EXAM), HAR[1][3])
    uid = ring_session.calls[0][1]["uid"]
    check("KeyRing uid is one RSA block", len(base64.b64decode(uid)), 128)

    # -- practice round: the whole mastery homework flow, end to end --------
    from zhs_fake_gateway import FakeGateway, QUESTION_1, QUESTION_2  # noqa: E402

    from studyflow.platforms.zhidao.zhs_mastery import (  # noqa: E402
        COURSE_TYPE_AI_HOMEWORK,
        EXAM_TYPE_PRACTICE,
        ZhsMasteryClient,
        decode_answer,
        format_answer,
        resolve_option,
    )

    all_correct = {
        939136618: 671372794,
        939136619: [671372795, 671372796, 671372797, 671372798, 671372799],
    }
    gateway = FakeGateway()
    result = ZhsMasteryClient(gateway).practice_round(
        sc_map_id="2095430049486426112", course_id="2095430049486426112",
        class_id="339597", knowledge_id="1853343377786015744",
        answers=all_correct, delay=0,
    )
    urls = [url.split("zhihuishu.com")[-1] for url in gateway.urls()]
    check("practice request order", urls, [
        "/run/gateway/t/stu/exam/questions-paper",
        "/gateway/t/v1/exam/user/openExam",
        "/gateway/t/v1/exam/user/getExamTestUserInfo",
        "/gateway/t/v1/exam/user/getExamSheetInfo",
        "/gateway/t/v1/question/getExamQuestionInfo",
        "/gateway/t/v1/question/getExamQuestionInfo",
        "/gateway/t/v1/answer/saveAnswer",
        "/gateway/t/v1/answer/saveAnswer",
        "/gateway/t/v1/exam/user/submit",
        "/gateway/t/v1/exam/user/getExamSheetInfo",
        "/gateway/t/v1/question/getExamQuestionInfo",
        "/gateway/t/v1/question/getExamQuestionInfo",
        "/run/gateway/t/stu/exam/questions-paper",
    ])
    check("practice examType is 知识点练习", result["examType"], EXAM_TYPE_PRACTICE)
    check("practice limitTime is 0", result["limitTime"], 0)
    check("practice progress before",
          (result["progressBefore"].answer_count, result["progressBefore"].question_count), (0, 2))
    check("practice progress after",
          (result["progressAfter"].answer_count, result["progressAfter"].question_count), (2, 2))
    check("practice submitted", result["submitted"], True)
    check("practice round score", result["roundScore"], {"correct": 2, "total": 2, "percent": 100})
    check("practice graded flags", [item["isCorrect"] for item in result["graded"]], [True, True])
    check("practice mastery after re-read", result["masteryAfter"]["highScore"], 100)
    check("redo opens a new examTestId",
          result["nextRound"]["examTestId"] != result["examTestId"], True)
    check("resolve_option single", resolve_option(QUESTION_1, "新时代"), 671372794)
    check("resolve_option multi",
          resolve_option(QUESTION_2, "共同富裕", "伟大复兴"), [671372797, 671372798])
    check("format_answer choice", format_answer([671372794], 1), "671372794")
    check("format_answer multi", format_answer([671372795, 671372796], 2), "671372795#@#671372796")
    check("format_answer fill", format_answer(["生产力", "生产关系"], 3), "生产力/生产关系")
    check("decode_answer single", decode_answer("671372794", 1), 671372794)
    check("decode_answer multi", decode_answer("671372795#@#671372796", 2), [671372795, 671372796])
    check("decode_answer fill", decode_answer("生产力/生产关系", 3), ["生产力", "生产关系"])
    check("decode_answer roundtrip", decode_answer(format_answer([671372797, 671372798], 2), 2),
          [671372797, 671372798])

    submit_call = next(c for c in gateway.calls if c["url"].endswith("/exam/user/submit"))
    submit_plain = json.loads(unseal_payload(submit_call["data"]["secretStr"], CKEY_EXAM))
    check("submit body matches HomeworkCtx._submit", submit_plain, {
        "examTestId": 4263949,
        "courseId": 2095430049486426112,
        "courseType": COURSE_TYPE_AI_HOMEWORK,
        "examPaperId": 454449917,
        "aiKnlowledgeId": 1853343377786015744,
    })

    wrong_gateway = FakeGateway()
    wrong = ZhsMasteryClient(wrong_gateway).practice_round(
        sc_map_id="1", course_id="1", class_id="1", knowledge_id="1",
        answers={939136618: 671372791, 939136619: all_correct[939136619]},
        delay=0, verify=False,
    )
    check("wrong single choice scores 1/2", wrong["roundScore"], {"correct": 1, "total": 2, "percent": 50})
    check("wrong answer exposes correct option",
          wrong["graded"][0]["correctOptionIds"], [671372794])

    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed")
        return 1
    print(f"all {CHECKS} checks passed: 2 key blobs, 5 captured bodies (seal+unseal), "
          f"5 payload builders, 1 header token, 4 KeyRing wiring assertions, "
          f"submit body, answer codec and 23 practice-round assertions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
