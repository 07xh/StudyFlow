from studyflow.services.bridge import dispatch


def test_ping():
    assert dispatch({"id": "a", "version": 1, "operation": "ping"})["data"]["version"] == 1


def test_status_contract():
    result = dispatch({"id": "b", "version": 1, "operation": "platform.status"})
    assert result["ok"]
    assert [p["platform"] for p in result["data"]] == ["zhidao", "yuketang"]
    assert all(isinstance(p["connected"], bool) for p in result["data"])


def test_unknown_platform():
    result = dispatch({"id": "c", "version": 1, "operation": "courses.list", "platform": "unknown"})
    assert result["error"] == "UNKNOWN_PLATFORM"


def test_yuketang_progress_returns_only_current_run_snapshot(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    folder = tmp_path / "StudyFlow" / "legacy-logs" / "222-123456789000"
    folder.mkdir(parents=True)
    (folder / "刷课日志.log").write_text(
        "[2026-11-14 09:12] 服务器进度: 完成率=43.00%, 最后位置=80.0s\\n",
        encoding="utf-8",
    )
    request = {"id": "e", "version": 1, "operation": "yuketang.progress",
               "run_id": "222-123456789000"}
    result = dispatch(request)
    assert result["ok"] and result["data"]["server_percent"] == 43
    assert result["data"]["simulation_percent"] is None
    request["run_id"] = "222-123456789001"
    assert dispatch(request)["data"]["server_percent"] is None
    request["run_id"] = "../invalid"
    assert dispatch(request)["error"] == "INVALID_REQUEST"


def test_rejects_unrecognized_request():
    assert dispatch({"id": "d", "version": 1, "operation": "delete.all"})["error"] == "UNKNOWN_OPERATION"
