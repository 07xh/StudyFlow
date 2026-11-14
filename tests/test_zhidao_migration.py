from studyflow.platforms.zhidao.courses import identity, merge_source_lists
from studyflow.platforms.zhidao.diagnostics import diagnose, ResponseShapeError


def test_ai_identity():
    assert identity({"courseType": "ai", "courseId": 12, "classId": 3}) == ("ai", "12", "3")


def test_empty_course_source():
    assert merge_source_lists({"shared": [], "ai": []}, []) == []


def test_safe_shape_error():
    code, message = diagnose(ResponseShapeError("sensitive response"))
    assert code == "API_SHAPE"
    assert "sensitive response" not in message
