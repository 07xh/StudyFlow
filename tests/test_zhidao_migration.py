from studyflow.platforms.zhidao.courses import identity, merge_source_lists
from studyflow.platforms.zhidao.courses import ResponseShapeError as CourseShapeError
from studyflow.platforms.zhidao.diagnostics import diagnose, ResponseShapeError
from studyflow.platforms.zhidao.upstream import zhidao_courses, zhidao_diagnostics


def test_ai_identity():
    assert identity({"courseType": "ai", "courseId": 12, "classId": 3}) == ("ai", "12", "3")


def test_empty_course_source():
    assert merge_source_lists({"shared": [], "ai": []}, []) == []


def test_safe_shape_error():
    code, message = diagnose(ResponseShapeError("sensitive response"))
    assert code == "API_SHAPE"
    assert "sensitive response" not in message


def test_adapter_and_original_reader_share_shape_error_contract():
    # Both import paths must catch the same exception raised by course parsing.
    assert ResponseShapeError is zhidao_diagnostics.ResponseShapeError
    assert CourseShapeError is ResponseShapeError
    for parse in (identity, zhidao_courses.identity):
        try:
            parse({"courseType": "unexpected-sensitive-value"})
        except ResponseShapeError as exc:
            assert diagnose(exc) == zhidao_diagnostics.diagnose(exc)
            assert diagnose(exc)[0] == "API_SHAPE"
            assert "unexpected-sensitive-value" not in diagnose(exc)[1]
        else:
            raise AssertionError("unknown course type must be rejected")
