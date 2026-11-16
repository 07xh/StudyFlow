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


def test_sso_login_persists_only_session_and_no_password(monkeypatch):
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    changes = []
    monkeypatch.setattr(bridge, "ucampus_authenticate",
                        lambda user, password: UCampusConfig.from_dict({
                            "variant": "ai", "cookie": "jwt=header.payload.signature"}))
    monkeypatch.setattr(bridge, "ucampus_enrich_school", lambda config: config)
    monkeypatch.setattr(bridge.ucampus_runtime_bridge, "reset_runner", lambda: None)
    monkeypatch.setattr(bridge.ucampus_fabricated_bridge, "reset_runner", lambda: None)
    monkeypatch.setattr(bridge.ucampus_credentials, "save", lambda value: changes.append(value))
    monkeypatch.setattr(bridge.ucampus_monitor, "configure", lambda course, unit, enabled: {"enabled": False})
    result = call("ucampus.session.login", username="student", password="not-persisted")
    assert result == {"id": "ucampus-test", "ok": True, "data": {"saved": True, "variant": "ai", "monitor_reset": True}}
    assert len(changes) == 1
    assert changes[0]["cookie"] == "jwt=header.payload.signature"
    assert "password" not in changes[0]
    assert "username" not in changes[0]
    assert "not-persisted" not in str(result)


def test_sso_login_failure_does_not_replace_existing_credentials(monkeypatch):
    from studyflow.platforms.ucampus.sso_login import UCampusLoginError
    calls = []
    def reject(username, password):
        raise UCampusLoginError("UCAMPUS_LOGIN_VERIFICATION_REQUIRED")
    monkeypatch.setattr(bridge, "ucampus_authenticate", reject)
    monkeypatch.setattr(bridge.ucampus_credentials, "save", lambda _: calls.append("saved"))
    result = call("ucampus.session.login", username="student", password="secret")
    assert not result["ok"]
    assert result["error"] == "UCAMPUS_LOGIN_VERIFICATION_REQUIRED"
    assert not calls


def test_sso_login_preserves_session_if_optional_school_query_fails(monkeypatch):
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    stored = []
    config = UCampusConfig.from_dict({"variant": "ai",
                                      "cookie": "jwt=header.payload.signature"})
    monkeypatch.setattr(bridge, "ucampus_authenticate", lambda user, pw: config)
    monkeypatch.setattr(bridge, "ucampus_enrich_school", lambda incoming: incoming)
    monkeypatch.setattr(bridge.ucampus_runtime_bridge, "reset_runner", lambda: None)
    monkeypatch.setattr(bridge.ucampus_fabricated_bridge, "reset_runner", lambda: None)
    monkeypatch.setattr(bridge.ucampus_credentials, "save", lambda payload: stored.append(payload))
    result = call("ucampus.session.login", username="student", password="secret")
    assert result["ok"] and stored[0]["school_id"] == ""
    assert stored[0]["cookie"] == "jwt=header.payload.signature"


def test_readonly_monitor_bridge_requires_explicit_opt_in(monkeypatch):
    events = []
    monkeypatch.setattr(bridge.ucampus_monitor, "status",
                        lambda: {"enabled": False, "state": "disabled"})
    monkeypatch.setattr(bridge.ucampus_monitor, "configure",
                        lambda course, unit, enabled: events.append((course, unit, enabled))
                        or {"enabled": enabled, "state": "pending"})
    monkeypatch.setattr(bridge.ucampus_monitor, "tick",
                        lambda: {"enabled": True, "state": "verified", "passed": 1})
    assert call("ucampus.monitor.status")["data"]["enabled"] is False
    assert call("ucampus.monitor.tick")["data"]["passed"] == 1
    assert call("ucampus.monitor.configure", enabled=True,
                course_id="course-v2:eng+1", unit_id="U1")["data"]["enabled"] is True
    assert events == [("course-v2:eng+1", "U1", True)]


def test_monitor_errors_are_fixed_codes(monkeypatch):
    from studyflow.platforms.ucampus.readonly_monitor import UCampusMonitorError
    def bad(*args):
        raise UCampusMonitorError("Authorization: should-never-appear")
    monkeypatch.setattr(bridge.ucampus_monitor, "configure", bad)
    result = call("ucampus.monitor.configure", enabled=True,
                  course_id="course-v2:real+1", unit_id="U1")
    assert result["error"] == "UCAMPUS_MONITOR_UNAVAILABLE"
    assert "Authorization" not in str(result)


def test_sso_success_does_not_mask_optional_monitor_cleanup_failure(monkeypatch):
    from studyflow.platforms.ucampus.credentials import UCampusConfig
    from studyflow.platforms.ucampus.readonly_monitor import UCampusMonitorError
    config = UCampusConfig.from_dict({"variant": "ai", "cookie": "jwt=head.payload.sign"})
    stored = []
    monkeypatch.setattr(bridge, "ucampus_authenticate", lambda user, pw: config)
    monkeypatch.setattr(bridge, "ucampus_enrich_school", lambda incoming: incoming)
    monkeypatch.setattr(bridge.ucampus_runtime_bridge, "reset_runner", lambda: None)
    monkeypatch.setattr(bridge.ucampus_fabricated_bridge, "reset_runner", lambda: None)
    monkeypatch.setattr(bridge.ucampus_credentials, "save", lambda data: stored.append(data))
    def cleanup_failure(*args):
        raise UCampusMonitorError("UCAMPUS_MONITOR_STORAGE_FAILED")
    monkeypatch.setattr(bridge.ucampus_monitor, "configure", cleanup_failure)
    result = call("ucampus.session.login", username="student", password="secret")
    assert result["ok"] and result["data"]["saved"] is True
    assert result["data"]["monitor_reset"] is False
    assert len(stored) == 1
