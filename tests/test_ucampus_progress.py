"""Offline contract tests for upstream U校园AI read-only progress shapes."""
from __future__ import annotations

import base64
import json
import pytest

from studyflow.platforms.ucampus.credentials import UCampusConfig
from studyflow.platforms.ucampus.course_progress import (
    UCampusProgressReader, UCampusProgressError, parse_tasks, parse_units,
)


def _config():
    payload = base64.urlsafe_b64encode(json.dumps({"openId": "my-open-id"}).encode()).decode().rstrip("=")
    return UCampusConfig.from_dict({"variant": "ai", "cookie": f"jwt=header.{payload}.signature"})


def test_course_units_only_use_upstream_map():
    assert parse_units({"units": {"unit2": {"strategies": {}}, "unit1": {}}}) == [
        {"id": "unit1", "title": "", "completed": None},
        {"id": "unit2", "title": "", "completed": None}]
    with pytest.raises(UCampusProgressError):
        parse_units({"bad": {"unit1": {}}})


def test_task_state_is_distinct_from_local_learning_time():
    tasks = parse_tasks({"leafs": {
        "video1": {"tab_type": "video", "strategies": {"required": True}, "state": {"pass": 1}},
        "audio1": {"tab_type": "audio", "state": {"pass": 0}},
        "quiz1": {"tab_type": "task", "state": None},
    }}, "unit1")
    by_id = {row["id"]: row for row in tasks}
    assert by_id["video1"]["completed"] is True and by_id["video1"]["required"] is True
    assert by_id["audio1"]["completed"] is False
    assert by_id["quiz1"]["completed"] is None
    assert all(row["title"] == "" and "progress_percent" not in row for row in tasks)


def test_reader_builds_only_first_party_urls_and_requires_jwt_open_id(monkeypatch):
    cfg = _config()
    seen = []
    class Response:
        status_code = 200
        is_redirect = False
        headers = {"content-type": "application/json"}
        content = b'{"rt":{"units":{"1":{}}}}'
        def json(self): return {"rt": {"units": {"1": {}}}}
    def get(url, **kwargs):
        seen.append((url, kwargs))
        return Response()
    monkeypatch.setattr("studyflow.platforms.ucampus.course_progress.requests.get", get)
    reader = UCampusProgressReader(credentials_loader=lambda: cfg)
    assert reader.list_units("course123")[0]["id"] == "1"
    assert len(seen) == 1
    assert "/course_progress/course123/my-open-id/default" in seen[0][0]
    assert seen[0][1]["allow_redirects"] is False
    assert seen[0][1]["headers"]["u-openid"] == "my-open-id"
    assert seen[0][1]["headers"]["Authorization"].startswith("header.")
    with pytest.raises(UCampusProgressError, match="INVALID_REQUEST"):
        reader.list_units("../other")
    assert len(seen) == 1
    missing = UCampusConfig.from_dict({"variant": "ai", "cookie": "sid=only"})
    with pytest.raises(UCampusProgressError, match="UCAMPUS_OPEN_ID_REQUIRED"):
        UCampusProgressReader(credentials_loader=lambda: missing).list_units("course123")
    assert len(seen) == 1


def test_rejects_unrecognized_server_format(monkeypatch):
    cfg = _config()
    class Response:
        status_code = 200
        is_redirect = False
        headers = {"content-type": "application/json"}
        content = b'{"data":[]}'
        def json(self): return {"data": []}
    monkeypatch.setattr("studyflow.platforms.ucampus.course_progress.requests.get",
                        lambda *args, **kwargs: Response())
    with pytest.raises(UCampusProgressError, match="UCAMPUS_PROGRESS_FORMAT_UNVERIFIED"):
        UCampusProgressReader(credentials_loader=lambda: cfg).list_units("course123")


def test_user_owned_content_headers_are_only_sent_to_fixed_ucontent(monkeypatch):
    original = _config()
    cfg = UCampusConfig.from_dict({
        "variant": "ai", "cookie": original.cookie,
        "annotator_token": "user-owned-token", "school_id": "8320"
    })
    observed = []
    class Response:
        status_code = 200
        is_redirect = False
        headers = {"content-type": "application/json"}
        content = b'{"rt":{"units":{}}}'
        def json(self):
            return {"rt": {"units": {}}}
    def get(url, **kwargs):
        observed.append((url, kwargs))
        return Response()
    monkeypatch.setattr("studyflow.platforms.ucampus.course_progress.requests.get", get)
    assert UCampusProgressReader(credentials_loader=lambda: cfg).list_units("course1") == []
    assert len(observed) == 1
    url, args = observed[0]
    assert url.startswith("https://ucontent.unipus.cn/course/api/v2/course_progress/")
    assert args["headers"]["x-annotator-auth-token"] == "user-owned-token"
    assert args["headers"]["u-school"] == "8320"
    assert args["allow_redirects"] is False


def test_real_course_v2_id_is_valid_path_segment(monkeypatch):
    cfg = _config()
    seen = []
    class Response:
        status_code = 200
        is_redirect = False
        headers = {"content-type": "application/json"}
        content = b'{"rt":{"units":{"U1":{}}}}'
        def json(self): return {"rt": {"units": {"U1": {}}}}
    def get(url, **kwargs):
        seen.append((url, kwargs))
        return Response()
    monkeypatch.setattr("studyflow.platforms.ucampus.course_progress.requests.get", get)
    reader = UCampusProgressReader(credentials_loader=lambda: cfg)
    assert reader.list_units("course-v2:real-id")[0]["id"] == "U1"
    real_id = "course-v2:75b7546ea002b72+nhce_v4_rw_2+20230116"
    assert reader.list_units(real_id)[0]["id"] == "U1"
    assert "/course_progress/course-v2:real-id/" in seen[0][0]
    assert f"/course_progress/{real_id}/" in seen[1][0]
    assert all(request[1]["allow_redirects"] is False for request in seen)
    for bad in ("course-v2:../private", "course-v2:%2Fetc", "course-v2:?k=v",
                "course-v2:ok+foo/bar", "course-v2:ok#fragment"):
        with pytest.raises(UCampusProgressError, match="INVALID_REQUEST"):
            reader.list_units(bad)
    assert len(seen) == 2


def test_real_plus_delimited_course_id_reads_unit_resource_without_rewriting_path(monkeypatch):
    cfg = _config()
    calls = []
    class Response:
        status_code = 200
        is_redirect = False
        headers = {"content-type": "application/json"}
        content = b'{"rt":{"leafs":{"resource1":{"tab_type":"video","state":{"pass":0}}}}}'
        def json(self):
            return {"rt": {"leafs": {"resource1": {"tab_type": "video", "state": {"pass": 0}}}}}
    def get(url, **kwargs):
        calls.append((url, kwargs))
        return Response()
    monkeypatch.setattr("studyflow.platforms.ucampus.course_progress.requests.get", get)
    reader = UCampusProgressReader(credentials_loader=lambda: cfg)
    course_id = "course-v2:75b7546ea002b72+nhce_v4_rw_2+20230116"
    tasks = reader.list_tasks(course_id, "U1")
    assert len(tasks) == 1 and tasks[0]["completed"] is False
    assert f"/course_progress/{course_id}/U1/" in calls[0][0]
    assert calls[0][1]["allow_redirects"] is False
