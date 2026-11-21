"""Local no-AI attempt strategy for a replayable mastery quiz.

Verified platform answers are supplied by Bank.get(), not by this helper.
Unknown questions are tried within bounded attempts; never label guesses verified.
"""
from __future__ import annotations

from itertools import combinations

from . import mastery as m


class LocalTrial:
    def answer(self, question: m.Question, history: list[dict]) -> tuple[list[str], str]:
        # Avoid fabricated answers for text blanks or unsupported controls.
        if question.kind == "text":
            raise m.Halt("填空题没有已确认答案，请在官方页面完成后重新同步解析")
        for row in history:
            correct = row.get("correct_answer")
            if isinstance(correct, list):
                try:
                    return m.validate_answer(question, correct), "历史官方解析"
                except m.Halt:
                    continue
            text = row.get("correct_text")
            if isinstance(text, str):
                answer = m.review_answer(question, text)
                if answer is not None:
                    return answer, "历史官方解析"
        rejected = {
            tuple(sorted(row["rejected_answer"]))
            for row in history
            if isinstance(row.get("rejected_answer"), list)
        }
        # Single-choice and bounded multiple-choice alternatives; score is never
        # taken as evidence that a trial answer is correct.
        sizes = (1,) if question.kind == "single" else range(1, min(4, len(question.options)) + 1)
        for size in sizes:
            for group in combinations(question.options, size):
                candidate = list(group)
                if tuple(sorted(candidate)) not in rejected:
                    return m.validate_answer(question, candidate), "待平台确认的试答"
        raise m.Halt("已尝试的选项无法得到正确答案，请手动查看平台解析")
