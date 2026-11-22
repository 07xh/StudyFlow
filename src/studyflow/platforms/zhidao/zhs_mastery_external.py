"""Map third-party question-bank references to a Zhidao *practice* draft.

No platform credentials or question IDs leave the device; only stem, type and
option text. External suggestions never become verified AnswerBank records
until the platform itself confirms correctness.
"""
from __future__ import annotations

import re
from html import unescape
from typing import Any

from studyflow.services import question_bank


LABELS = {1: "单选", 2: "多选", 3: "填空", 14: "判断"}


def _visible(value: Any) -> str:
    text = unescape(re.sub(r"<[^>]*>", " ", str(value or "")))
    return re.sub(r"\s+", " ", text).strip()


def payload(question: dict[str, Any]) -> dict[str, Any]:
    """Use standardized non-identifying question fields only."""
    kind = question.get("question_type")
    if kind not in LABELS:
        raise ValueError("不支持此题型的外部题库查询")
    title = _visible(question.get("content"))
    if not title or len(title) > 4000:
        raise ValueError("题干为空或过长")
    options = []
    if kind != 3:
        rows = question.get("options") or []
        if not isinstance(rows, list) or not 1 <= len(rows) <= 20:
            raise ValueError("题目选项不完整")
        for i, item in enumerate(rows):
            if not isinstance(item, dict) or type(item.get("id")) is not int:
                raise ValueError("无效选项")
            label = chr(65 + i)
            text = _visible(item.get("content"))
            if not text or len(text) > 500:
                raise ValueError("选项不完整或过长")
            options.append({"key": label, "text": text})
    return {"title": title, "question_type": LABELS[kind], "options": options}


def convert(question: dict[str, Any], answer: Any) -> tuple[Any, str, list[str]] | None:
    """Return a valid platform draft only for an unambiguous reference answer.

    Reject prose/explanations rather than guessing option IDs, which could
    silently save an unrelated response.
    """
    from studyflow.platforms.zhidao.zhs_mastery_auto import _identity, _normalize
    if not isinstance(answer, str) or not answer.strip() or len(answer) > 8000:
        return None
    identity, pairs = _identity(question)
    if not identity:
        return None
    kind = question.get("question_type")
    text = answer.strip()
    text = re.sub(r"^(?:参考)?答案\s*[:：]\s*", "", text, flags=re.I).strip()
    if not text:
        return None
    if kind == 3:
        # Prefer a single unmodified text field. Multiple blanks may be
        # separated by pipes, with no ambiguous comma/sentence splitting.
        parts = [part.strip() for part in text.split("|")]
        if not all(parts) or len(parts) > 12 or any(len(part) > 2000 for part in parts):
            return None
        return (parts if len(parts) > 1 else parts[0]), identity, parts
    if kind not in (1, 2, 14) or not 2 <= len(pairs) <= 20:
        return None

    # Exact option-text matches take precedence over letter parsing.
    by_text = {_normalize(label): (option_id, label)
               for option_id, label in pairs}
    selected: list[tuple[int, str]] = []
    exact = by_text.get(_normalize(text))
    if exact is not None:
        selected = [exact]
    else:
        letters = re.fullmatch(r"[A-Za-z](?:[\s,，、;/|+]*[A-Za-z])*", text)
        if not letters:
            return None
        indices = [ord(char.upper()) - 65 for char in text if char.isalpha()]
        if len(indices) != len(set(indices)) or any(i < 0 or i >= len(pairs) for i in indices):
            return None
        selected = [pairs[i] for i in indices]
    if not selected or (kind in (1, 14) and len(selected) != 1):
        return None
    return ([i for i, _ in selected] if kind == 2 else selected[0][0],
            identity, [label for _, label in selected])


def suggest(question: dict[str, Any], provider_id: str, token_id: str | None) -> tuple[Any, str, list[str]] | None:
    """One user-authorized lookup; not a submission or official confirmation."""
    response = question_bank.query_question(provider_id, payload(question), token_id)
    if not response.get("found"):
        return None
    return convert(question, response.get("answer"))
