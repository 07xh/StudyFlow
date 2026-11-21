"""Offline proof that the recovered seal reproduces real Zhihuishu traffic.

Vectors live in ``zhs_mastery_vectors.py`` (verbatim from the HAR).  No network
access: the two ``sl`` blobs are key-service responses and each ``secretStr`` is
what the page actually sent for the matching body.
"""
import base64
import json

import pytest

from studyflow.platforms.zhidao.zhs_mastery import (
    MODULE_EXAM,
    MODULE_KG_AI,
    answer_payload,
    exam_ref_payload,
    open_exam_payload,
    paper_payload,
    question_payload,
    rsa_public_decrypt,
    seal_payload,
    unseal_payload,
)

from zhs_mastery_vectors import (
    CKEY_EXAM,
    CKEY_KG_AI,
    HAR,
    KEY_BLOB_EXAM,
    KEY_BLOB_KG_AI,
    SL_EXAM,
    SL_KG_AI,
    XQJZXHIZ,
)


def _key_from_sl(sl: str) -> dict:
    return json.loads(rsa_public_decrypt(base64.b64decode(sl)).decode("utf-8"))


def test_key_blob_decodes_with_public_exponent():
    assert _key_from_sl(SL_KG_AI) == KEY_BLOB_KG_AI
    assert _key_from_sl(SL_EXAM) == KEY_BLOB_EXAM


def _ckey(module: int) -> str:
    return CKEY_EXAM if module == MODULE_EXAM else CKEY_KG_AI


@pytest.mark.parametrize("module,label,payload,expected", HAR, ids=[row[1] for row in HAR])
def test_seal_reproduces_captured_secret_str(module, label, payload, expected):
    assert seal_payload(payload, _ckey(module)) == expected


@pytest.mark.parametrize("module,label,payload,expected", HAR, ids=[row[1] for row in HAR])
def test_unseal_round_trips(module, label, payload, expected):
    assert json.loads(unseal_payload(expected, _ckey(module))) == payload


def test_payload_builders_match_captured_field_order_and_types():
    assert open_exam_payload(
        exam_test_id=4263949, exam_paper_id=454449917, course_id="2095430049486426112",
    ) == HAR[0][2]
    assert exam_ref_payload(exam_test_id=4263949, exam_paper_id="454449917") == HAR[1][2]
    assert question_payload(
        exam_test_id="4263949", exam_paper_id="454449917", question_id=939136618, version=1,
    ) == HAR[2][2]
    assert answer_payload(
        recruit_id=2095430049486426112, exam_test_id=4263949, exam_paper_id=454449917,
        question_id=939136618,
    ) == HAR[3][2]
    assert paper_payload(
        sc_map_id=2095430049486426112, course_id=2095430049486426112,
        class_id=339597, knowledge_id=1853343377786015744, date_formate=1795272661000,
    ) == HAR[4][2]


def test_builder_output_seals_to_wire_value_end_to_end():
    assert seal_payload(
        open_exam_payload(
            exam_test_id=4263949, exam_paper_id=454449917, course_id="2095430049486426112",
        ),
        CKEY_EXAM,
    ) == HAR[0][3]


def test_empty_string_header_token_matches_capture():
    assert seal_payload("", CKEY_KG_AI) == XQJZXHIZ


def test_chinese_answer_stays_raw_utf8():
    sealed = seal_payload({"answer": "新时代"}, CKEY_EXAM)
    assert '"新时代"' in unseal_payload(sealed, CKEY_EXAM)


def test_rejects_wrong_key_length():
    with pytest.raises(ValueError):
        seal_payload({"a": 1}, "short")
