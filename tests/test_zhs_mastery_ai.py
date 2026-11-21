"""No-network response validation and privacy checks for optional DeepSeek mastery."""
from __future__ import annotations

import json

import pytest

from studyflow.platforms.zhidao import zhs_mastery_ai as ai


QUESTION = {
    "question_type":1,"content":"<p>甲和乙，哪个正确？</p>",
    "question_id":1234567,
    "options":[{"id":21,"content":"甲"},{"id":22,"content":"乙"}],
}


class Reply:
    def __init__(self, answer):
        self.status=200
        self.answer=answer

    def __enter__(self):
        return self

    def __exit__(self,*args):
        return None

    def read(self,count):
        return json.dumps({"choices":[{"message":{"content":json.dumps(
            {"answers":self.answer},ensure_ascii=False)}}]}).encode("utf-8")


def test_ai_only_sends_stem_and_options_and_maps_real_option_id(monkeypatch):
    recorded=[]
    def mock(request,timeout):
        body=json.loads(request.data)
        recorded.append((body,request,timeout))
        return Reply([22])
    monkeypatch.setattr(ai.urllib.request,"urlopen",mock)
    assert ai.suggest(QUESTION,"sk-only-for-test",10)==22
    body,request,timeout=recorded[0]
    assert body["model"]=="deepseek-flash"
    user=json.loads(body["messages"][1]["content"])
    assert user["question"]=="甲和乙，哪个正确？"
    assert user["options"]==[{"id":21,"content":"甲"},{"id":22,"content":"乙"}]
    assert "question_id" not in user
    assert "cookie" not in json.dumps(body).lower()
    assert "sk-only-for-test" not in json.dumps(body)


def test_ai_rejects_options_not_present_in_original_question(monkeypatch):
    monkeypatch.setattr(ai.urllib.request,"urlopen",lambda *args,**kwargs:Reply([111]))
    with pytest.raises(ai.AiAnswerError,match="AI_INVALID_OPTION"):
        ai.suggest(QUESTION,"sk-only-for-test",10)


def test_ai_accepts_multiple_text_blanks_without_guessing_count(monkeypatch):
    fill={**QUESTION,"question_type":3,"options":[]}
    monkeypatch.setattr(ai.urllib.request,"urlopen",
                        lambda *args,**kwargs:Reply(["生产力","生产关系"]))
    assert ai.suggest(fill,"sk-only-for-test",10)==["生产力","生产关系"]


def test_invalid_or_uncertain_ai_response_never_returns_fake_answer(monkeypatch):
    monkeypatch.setattr(ai.urllib.request,"urlopen",lambda *args,**kwargs:Reply([]))
    with pytest.raises(ai.AiAnswerError,match="AI_UNCERTAIN"):
        ai.suggest(QUESTION,"sk-only-for-test",10)
    with pytest.raises(ai.AiAnswerError,match="AI_NOT_CONFIGURED"):
        ai.suggest(QUESTION,"",10)
