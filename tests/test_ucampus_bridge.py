"""Ensure U校园 IPC enforces the read-only progress boundary."""
from studyflow.services import bridge
from studyflow.platforms.ucampus.course_progress import UCampusProgressError


def call(operation, **kwargs):
    return bridge.dispatch({"id": "ucampus-test", "version": 1, "operation": operation, **kwargs})


def test_units_list_dispatches_to_verified_reader(monkeypatch):
    seen = []
    class Reader:
        def list_units(self, course_id):
            seen.append(course_id)
            return [{"id": "U1", "title": "", "completed": None}]
        def list_tasks(self, course_id, unit_id):
            seen.append((course_id, unit_id))
            return [{"id": "R1", "unit_id": unit_id, "completed": True}]
    monkeypatch.setattr(bridge, "UCampusProgressReader", Reader)
    assert call("ucampus.units.list", course_id="course1")["data"][0]["id"] == "U1"
    assert call("ucampus.unit.tasks", course_id="course1", unit_id="U1")["data"][0]["id"] == "R1"
    assert seen == ["course1", ("course1", "U1")]


def test_errors_are_public_codes_no_cookie(monkeypatch):
    class Reader:
        def list_units(self, course_id):
            raise UCampusProgressError("UCAMPUS_OPEN_ID_REQUIRED")
    monkeypatch.setattr(bridge, "UCampusProgressReader", Reader)
    assert call("ucampus.units.list", course_id="test")["error"] == "UCAMPUS_OPEN_ID_REQUIRED"
    assert call("ucampus.unit.tasks", course_id=123, unit_id="U1")["error"] == "INVALID_REQUEST"
