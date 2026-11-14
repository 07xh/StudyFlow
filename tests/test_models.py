import pytest
from studyflow.core.models import Course, Platform


def test_course_contract():
    course = Course(Platform.ZHIDAO, "course-1", "课程")
    assert course.progress_percent is None


def test_progress_rejects_invalid_values():
    with pytest.raises(ValueError):
        Course(Platform.YUKETANG, "course-2", "课程", 101)



def test_server_verified_progress_requires_timestamp():
    with pytest.raises(ValueError, match="timestamp"):
        Course(Platform.ZHIDAO, "course-3", "课程", 25.0, "ai",
               progress_evidence="server_verified")
