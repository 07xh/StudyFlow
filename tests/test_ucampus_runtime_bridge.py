"""The native U校园 run mode is real local generation, never spoofed upload."""
from __future__ import annotations

import pytest

from studyflow.services import ucampus_runtime_bridge as service
from studyflow.platforms.ucampus.local_runtime import UCampusLocalRunner


def test_capabilities_and_no_server_sender():
    result = service.dispatch("ucampus.heartbeat.capabilities", {})
    assert result["ok"] is True
    assert result["local_generation"] is True
    assert result["sender_connected"] is False
    assert result["server_verified"] is False


def test_real_task_selection_then_local_generation_only(monkeypatch):
    runner = UCampusLocalRunner(interval=0.01)
    monkeypatch.setattr(service, "get_runner", lambda: runner)
    class Reader:
        def list_tasks(self, course_id, unit_id):
            assert (course_id, unit_id) == ("course1", "U1")
            return [
                {"id": "V1", "title": "", "type": "video", "completed": False},
                {"id": "A1", "title": "", "type": "Audio", "completed": None},
                {"id": "done", "title": "已完成", "type": "video", "completed": True},
                {"id": "quiz", "title": "作业", "type": "task", "completed": False},
            ]
    monkeypatch.setattr(service, "UCampusProgressReader", Reader)
    started = service.dispatch("ucampus.heartbeat.start",
                               {"course_id": "course1", "unit_id": "U1", "pulses": 1})
    assert started["ok"] is True
    assert len(started["tasks"]) == 2
    runner.shutdown()
    state = service.dispatch("ucampus.heartbeat.status", {"course_id": "course1"})
    assert state["generated"] >= 0
    assert state["sent"] == 0 and state["server_confirmed"] is None


def test_missing_unit_and_unsafe_controls_fail_closed(monkeypatch):
    monkeypatch.setattr(service, "get_runner",
                        lambda: UCampusLocalRunner(interval=0.01))
    assert service.dispatch("ucampus.heartbeat.start", {"course_id": "c"})["error"] == "UCAMPUS_INVALID_PARAMETER"
    assert service.dispatch("ucampus.heartbeat.pause",
                            {"course_id": "c", "run_id": "not-a-run"})["error"] == "UCAMPUS_RUN_ID_MISMATCH"
    assert service.dispatch("other.operation", {}) is None


def test_no_synthetic_course_targets(monkeypatch):
    class Reader:
        def list_tasks(self, course_id, unit_id):
            return []
    monkeypatch.setattr(service, "UCampusProgressReader", Reader)
    monkeypatch.setattr(service, "get_runner", lambda: UCampusLocalRunner())
    state = service.dispatch("ucampus.heartbeat.start",
                             {"course_id": "c", "unit_id": "U1"})
    assert state["error"] == "UCAMPUS_NO_MEDIA_TASKS"


def test_course_v2_id_enters_local_runner(monkeypatch):
    runner = UCampusLocalRunner(interval=0.01)
    monkeypatch.setattr(service, "get_runner", lambda: runner)
    class Reader:
        def list_tasks(self, course_id, unit_id):
            assert course_id == "course-v2:real-id"
            assert unit_id == "U1"
            return [{"id": "V1", "title": "视频", "type": "video", "completed": False}]
    monkeypatch.setattr(service, "UCampusProgressReader", Reader)
    state = service.dispatch("ucampus.heartbeat.start",
        {"course_id": "course-v2:real-id", "unit_id": "U1", "pulses": 1})
    assert state["ok"] and state["course_id"] == "course-v2:real-id"
    runner.shutdown()
