"""Offline parsing tests for external question-bank references in Zhidao practice."""
from __future__ import annotations

import pytest
from studyflow.platforms.zhidao import zhs_mastery_external as external


def item(kind=1, option_texts=("Alpha", "Beta", "Gamma")):
    return {"question_id": 99, "question_type": kind,
            "content": "<p>测试 <b>题干</b> &amp; 解释</p>",
            "options": [{"id": i + 11, "content": text}
                        for i, text in enumerate(option_texts)] if kind != 3 else []}


@pytest.mark.parametrize("reply,answer", [
    ("B", 12), ("答案：B", 12), ("beta", 12), ("  Beta  ", 12),
    ("C", 13),
])
def test_single_choice_maps_reference_letters_and_exact_text(reply, answer):
    picked = external.convert(item(), reply)
    assert picked is not None and picked[0] == answer


@pytest.mark.parametrize("reply", ["答案：B，解析：可能原因", "AB", "Z", "A,A", "CD",
                                      "", "不确定", "以上全对"])
def test_rejects_ambiguous_or_mismatched_single_choice(reply):
    assert external.convert(item(), reply) is None


def test_multi_option_and_judgement():
    result = external.convert(item(kind=2), "A、C")
    assert result is not None and result[0] == [11, 13]
    assert external.convert(item(kind=2), "ABC")[0] == [11, 12, 13]
    assert external.convert(item(kind=2), "A A") is None
    assert external.convert(item(kind=14, option_texts=("正确", "错误")), "错误")[0] == 12
    assert external.convert(item(kind=14, option_texts=("正确", "错误")), "B")[0] == 12


def test_fill_in_text_preserves_case_and_blanks():
    q = item(kind=3)
    assert external.convert(q, "答案：Voltage")[0] == "Voltage"
    assert external.convert(q, "A|B")[0] == ["A", "B"]
    assert external.convert(q, "A||B") is None


def test_payload_omits_platform_identifiers_and_strips_markup():
    q = {**item(), "cookie": "secret", "course_key": "private",
         "exam_test_id": 812, "knowledge_id": "1234"}
    value = external.payload(q)
    assert set(value) == {"title", "question_type", "options"}
    assert value["title"] == "测试 题干 & 解释"
    assert value["options"][1] == {"key": "B", "text": "Beta"}
    assert all(secret not in repr(value) for secret in ("secret", "private", "812", "1234"))


def test_suggest_calls_common_bank_once_with_selected_provider_and_token(monkeypatch):
    calls = []
    def lookup(provider, question, token_id):
        calls.append((provider, question, token_id))
        return {"found": True, "answer": "B"}
    monkeypatch.setattr(external.question_bank, "query_question", lookup)
    result = external.suggest(item(), "yanxi", "a" * 32)
    assert result is not None and result[0] == 12
    assert len(calls) == 1 and calls[0][2] == "a" * 32
    assert calls[0][1] == external.payload(item())


def test_unmatched_reference_does_not_use_raw_answer(monkeypatch):
    monkeypatch.setattr(external.question_bank, "query_question",
                        lambda *a: {"found": True, "answer": "选 B，因为... "})
    assert external.suggest(item(), "yanxi", "b" * 32) is None
