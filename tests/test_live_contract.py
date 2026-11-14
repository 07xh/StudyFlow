from studyflow.core.models import Course, Platform
from studyflow.core.platform_api import ConnectionInfo
from studyflow.services import bridge


class LiveStub:
    def connection_info(self):
        return ConnectionInfo(Platform.ZHIDAO, True, "server verified")

    def list_courses(self):
        return [Course(platform=Platform.ZHIDAO, course_id="771", title="服务器课程")]


def test_real_course_contract_when_adapter_succeeds(monkeypatch):
    monkeypatch.setitem(bridge.ADAPTERS, "zhidao", LiveStub())
    reply = bridge.dispatch({"id":"one","version":1,"operation":"courses.list","platform":"zhidao"})
    assert reply["ok"]
    assert reply["data"] == [{"platform":"zhidao","course_id":"771","title":"服务器课程","progress_percent":None}]


def test_unsupported_version_is_rejected():
    assert bridge.dispatch({"id":"x","version":0,"operation":"ping"})["error"] == "UNSUPPORTED_VERSION"
