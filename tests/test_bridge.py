from studyflow.services.bridge import dispatch


def test_ping():
    assert dispatch({"id": "a", "version": 1, "operation": "ping"})["data"]["version"] == 1


def test_status_contract():
    result = dispatch({"id": "b", "version": 1, "operation": "platform.status"})
    assert result["ok"]
    assert [p["platform"] for p in result["data"]] == ["zhidao", "yuketang"]
    assert all(isinstance(p["connected"], bool) for p in result["data"])


def test_unknown_platform():
    result = dispatch({"id": "c", "version": 1, "operation": "courses.list", "platform": "unknown"})
    assert result["error"] == "UNKNOWN_PLATFORM"


def test_rejects_unrecognized_request():
    assert dispatch({"id": "d", "version": 1, "operation": "delete.all"})["error"] == "UNKNOWN_OPERATION"
