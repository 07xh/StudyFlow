"""Offline-only tests for direct mastery HTTP transport and payload handling."""
import json
import sys
import types

import pytest

from studyflow.platforms.zhidao.mastery_helper.http_client import (
    MasteryHttpClient, MasteryProtocolError, Paper, question_ids,
)
from studyflow.platforms.zhidao.mastery_helper.http_worker import _question_model


class FakeCipher:
    def __init__(self, key, iv):
        assert isinstance(key, bytes) and len(key) == 16
        assert isinstance(iv, bytes) and len(iv) == 16

    def encrypt(self, value):
        return value  # Synthetic test: inspect JSON payload without crypto.


class FakeCrypto:
    def key_bytes(self, key):
        return b"0123456789abcdef"


class FakeResponse:
    def __init__(self, data):
        self.data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self.data


class FakeHttp:
    def __init__(self):
        self.calls = []
        self.replies = []

    def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        return FakeResponse(self.replies.pop(0))


class FakeSession:
    crypto = FakeCrypto()

    def __init__(self):
        self.client = FakeHttp()

    def _get_client(self):
        return self.client

    def ai_exam_submit(self, url, data):
        self.last_submit = (url, data)
        return True


@pytest.fixture
def api(monkeypatch):
    crypto_mod = types.ModuleType("zhs.crypto")
    crypto_mod.Cipher = FakeCipher
    zhs_mod = types.ModuleType("zhs")
    monkeypatch.setitem(sys.modules, "zhs", zhs_mod)
    monkeypatch.setitem(sys.modules, "zhs.crypto", crypto_mod)
    session = FakeSession()
    return MasteryHttpClient(session)


def test_paper_uses_ai_json_and_authenticated_only(api):
    api.session.client.replies.append({"code": 200, "data": {
        "examTestId": 1234, "paperId": 3456, "highMasteryScore": 75, "questionNum": 2
    }})
    paper = api.paper(100, 200, 300)
    assert (paper.course_id, paper.exam_test_id, paper.paper_id, paper.mastery) == (100, 1234, 3456, 75.0)
    method, url, kw = api.session.client.calls[-1]
    assert method == "POST" and url.endswith("/stu/exam/questions-paper")
    assert kw["json"]["date"] > 0
    secret = json.loads(kw["json"]["secretStr"])
    assert secret["courseId"] == "100" and secret["classId"] == "200"
    assert secret["knowledgeId"] == "300"
    assert "dateFormate" in secret
    assert kw["headers"]["Origin"].startswith("https://")


def test_exam_reads_question_and_save_confirmed_response(api):
    paper = Paper(100,200,300,1234,3456,50,1)
    api.session.client.replies.extend([
        {"code":0,"data":True},
        {"code":0,"data":{"partSheetVos":[{"questionSheetVos":[
            {"questionId":456,"version":1}]}],"answerCount":0}},
        {"code":0,"data":{"id":456,"content":"Q","questionType":1,
                           "questionTypeName":"单选题","optionVos":[]}},
        {"code":0,"data":True},
    ])
    assert api.open_exam(paper)
    assert question_ids(api.sheet(paper)) == [(456,1)]
    assert api.question(paper,456,1)["id"] == 456
    assert api.save_answer(paper,456,"781")
    method, url, kw = api.session.client.calls[-1]
    assert method == "POST" and url.endswith("/answer/saveAnswer")
    payload = json.loads(kw["data"]["secretStr"])
    assert payload["questionId"] == 456 and payload["answer"] == "781"
    assert payload["dataVos"] is None


def test_result_is_not_inferred_from_http_success(api):
    paper = Paper(100,200,300,1234,3456,None,None)
    api.submit_once(paper)
    url,payload = api.session.last_submit
    assert url.endswith("/exam/user/submit")
    assert payload["examPaperId"] == 3456
    assert paper.mastery is None


def test_sheet_rejects_duplicates_and_bad_ids():
    assert question_ids({"partSheetVos":[{"questionSheetVos":[
        {"questionId":11,"version":1}, {"questionId":12,"version":1}]}]}) == [(11,1),(12,1)]
    with pytest.raises(MasteryProtocolError):
        question_ids({"partSheetVos":[{"questionSheetVos":[
            {"questionId":11,"version":1}, {"questionId":11,"version":1}]}]})
    with pytest.raises(MasteryProtocolError):
        question_ids({"partSheetVos":[{"questionSheetVos":[
            {"questionId":"../../foo","version":1}]}]})


def test_question_model_preserves_option_ids():
    q,option_ids = _question_model({"id":44,"content":"<p>二选一</p>",
        "questionType":1,"questionTypeName":"单选题","optionVos":[
            {"id":9,"sort":2,"content":"第二项"},
            {"id":7,"sort":1,"content":"第一项"}]})
    assert q.stem == "二选一"
    assert option_ids[q.options[0]] == "7"
    assert option_ids[q.options[1]] == "9"
