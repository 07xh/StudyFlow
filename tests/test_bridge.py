from studyflow.services.bridge import dispatch


def test_ping():
    assert dispatch({"id":"a","version":1,"operation":"ping"})["data"]["version"] == 1


def test_status_not_fake():
    result = dispatch({"id":"b","version":1,"operation":"platform.status"})
    assert result["ok"]
    assert len(result["data"]) == 2
    assert all(not item["connected"] for item in result["data"])


def test_course_reading_fails_closed():
    result = dispatch({"id":"c","version":1,"operation":"courses.list","platform":"zhidao"})
    assert result == {"id":"c","ok":False,"error":"PLATFORM_NOT_READY"}


def test_rejects_unrecognized_request():
    assert dispatch({"id":"d","version":1,"operation":"delete.all"})["error"] == "UNKNOWN_OPERATION"
