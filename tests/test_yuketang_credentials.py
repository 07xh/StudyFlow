import pytest
from studyflow.platforms.yuketang.credentials import YuketangConfig
from studyflow.platforms.yuketang.adapter import _course_name


def test_rejects_missing_and_placeholder_credentials():
    with pytest.raises(ValueError):
        YuketangConfig.from_dict({"session_id": "foo"})

def test_class_name_requires_real_server_evidence():
    assert _course_name({"success": True, "data": {"course": {"name": "真实课程"}}}) == "真实课程"
    with pytest.raises(RuntimeError):
        _course_name({"success": False, "data": {"name": "课程"}})
