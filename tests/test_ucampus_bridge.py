"""Ensure U校园 IPC enforces the read-only progress boundary."""
from studyflow.services import bridge
from studyflow.platforms.ucampus.course_progress import UCampusProgressError
from studyflow.platforms.ucampus.adapter import UCampusCatalogError


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


def test_course_v2_id_through_python_bridge(monkeypatch):
    class Reader:
        def list_units(self, course_id):
            assert course_id == "course-v2:real-id"
            return [{"id": "U1", "title": "", "completed": None}]
    monkeypatch.setattr(bridge, "UCampusProgressReader", Reader)
    response = call("ucampus.units.list", course_id="course-v2:real-id")
    assert response["ok"] is True
    assert response["data"][0]["id"] == "U1"

def test_server_status_verification_reads_platform_flags_only(monkeypatch):
    class Reader:
        def list_tasks(self, course_id, unit_id):
            assert (course_id, unit_id) == ("course-v2:real-id", "u1")
            return [
                {"id":"V1","type":"video","required":True,"completed":True},
                {"id":"A1","type":"audio","required":True,"completed":False},
                {"id":"Q1","type":"task","required":None,"completed":None},
            ]
    monkeypatch.setattr(bridge,"UCampusProgressReader",Reader)
    response=call("ucampus.progress.verify",course_id="course-v2:real-id",unit_id="u1")
    assert response["ok"]
    value=response["data"]
    assert (value["total"],value["passed"],value["not_passed"],value["unknown"])==(3,1,1,1)
    assert (value["required_total"],value["required_passed"])==(2,1)
    assert value["verified_at"].endswith("+00:00")
    assert "progress_percent" not in value
    assert call("ucampus.progress.verify",course_id="course1")["error"]=="INVALID_REQUEST"


def test_server_status_verification_reports_expired_session(monkeypatch):
    class Reader:
        def list_tasks(self,course_id,unit_id):
            raise UCampusProgressError("UCAMPUS_SESSION_EXPIRED")
    monkeypatch.setattr(bridge,"UCampusProgressReader",Reader)
    response=call("ucampus.progress.verify",course_id="course1",unit_id="U1")
    assert response == {"id":"ucampus-test","ok":False,"error":"UCAMPUS_SESSION_EXPIRED"}

def test_catalog_diagnostics_preserve_known_codes_not_untrusted_text(monkeypatch):
    class Expired:
        def list_courses(self):
            raise UCampusCatalogError("UCAMPUS_SESSION_EXPIRED")
    monkeypatch.setitem(bridge.ADAPTERS, "ucampus", Expired())
    assert call("courses.list", platform="ucampus")["error"] == "UCAMPUS_SESSION_EXPIRED"

    class UnknownFormat:
        def list_courses(self):
            raise UCampusCatalogError("UCAMPUS_CATALOG_FORMAT_UNVERIFIED")
    monkeypatch.setitem(bridge.ADAPTERS, "ucampus", UnknownFormat())
    assert call("courses.list", platform="ucampus")["error"] == "UCAMPUS_CATALOG_FORMAT_UNVERIFIED"

    class UntrustedException:
        def list_courses(self):
            raise UCampusCatalogError("Cookie: secret=never-expose")
    monkeypatch.setitem(bridge.ADAPTERS, "ucampus", UntrustedException())
    assert call("courses.list", platform="ucampus")["error"] == "PLATFORM_NOT_READY"


def test_other_platform_catalog_errors_remain_generic(monkeypatch):
    class UnexpectedCatalogError:
        def list_courses(self):
            raise UCampusCatalogError("UCAMPUS_SESSION_EXPIRED")
    monkeypatch.setitem(bridge.ADAPTERS, "zhidao", UnexpectedCatalogError())
    assert call("courses.list", platform="zhidao")["error"] == "PLATFORM_NOT_READY"
