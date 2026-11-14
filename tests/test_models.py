import pytest
from studyflow.core.models import Course, Platform


def test_course_contract():
    course = Course(Platform.ZHIDAO, "course-1", "课程")
    assert course.progress_percent is None


def test_progress_rejects_invalid_values():
    with pytest.raises(ValueError):
        Course(Platform.YUKETANG, "course-2", "课程", 101)
