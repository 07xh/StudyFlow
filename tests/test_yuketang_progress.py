from studyflow.services.yuketang_progress import (
    empty_progress, parse_original_log, read_session_progress
)


def test_simulated_and_server_progress_are_separate():
    log = (
        "开始批量观看视频...\n准备观看 2 个视频\n"
        "正在处理第 1/2 个视频\n开始模拟观看视频\n"
        "发送心跳成功 - 位置: 30.0s/120.0s (25.0%), 事件: playing\n"
        "服务器进度: 完成率=10.00%, 最后位置=12.0s\n"
        "✅ 视频观看完成\n正在处理第 2/2 个视频\n"
        "开始模拟观看视频\n发送心跳成功 - 位置: 10.0s/50.0s (20.0%), 事件: playing\n"
    )
    p = parse_original_log(log)
    assert p["concurrent"] is False
    assert p["total"] == 2 and p["current_index"] == 2
    assert p["success"] == 1 and p["processed"] == 1
    assert p["simulation_percent"] == 20
    assert p["server_percent"] is None  # Previous video's server value must not leak.


def test_final_verified_rate_and_concurrent_summary():
    p = parse_original_log(
        "开始并发观看视频... (最大并发数: 3)\n"
        "准备观看 3 个视频\n"
        "发送心跳成功 - 位置: 14.0s/70.0s (20.0%), 事件: playing\n"
        "最终进度: 完成率=58.50%, 最后位置=40.1s\n"
        "[主线程] ✅ (1/3) 成功完成: A\n"
        "[主线程] ⏭️ (2/3) 跳过已完成 (98.0%): B\n"
        "[主线程] ❌ (3/3) 失败 (错误): C\n"
        "并发观看完成！\n总视频数: 3\n成功观看: 1\n"
        "跳过（已完成）: 1\n失败: 1\n手动停止: 0\n"
    )
    assert p["concurrent"] is True and p["processed"] == 3
    assert (p["success"], p["skipped"], p["failed"]) == (1, 1, 1)
    assert p["server_percent"] == 58.5 and p["server_source"] == "final"
    assert p["simulation_percent"] == 20


def test_no_fabricated_percent_when_only_task_state_or_bad_values():
    p = parse_original_log(
        "开始模拟观看视频\n"
        "发送心跳成功 - 位置: 999.0s/20.0s (500.0%), 事件: playing\n"
        "服务器进度: 完成率=101.00%, 最后位置=30.0s\n"
    )
    assert p["simulation_percent"] is None
    assert p["server_percent"] is None
    assert empty_progress()["available"] is False


def test_session_isolation_and_no_path_traversal(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    session = "123-456789012"
    folder = tmp_path / "StudyFlow" / "legacy-logs" / session
    folder.mkdir(parents=True)
    (folder / "刷课日志.log").write_text(
        "服务器进度: 完成率=38.00%, 最后位置=8.0s\n", encoding="utf-8"
    )
    assert read_session_progress(session)["server_percent"] == 38
    assert read_session_progress("123-456789013")["server_percent"] is None
    import pytest
    with pytest.raises(ValueError):
        read_session_progress("../" + session)


def test_richtext_stats_do_not_leak_into_video_failure_count():
    p = parse_original_log(
        "开始批量浏览图文内容...\n"
        "准备浏览 2 个图文\n"
        "正在处理第 1/2 个图文\n"
        "图文批量浏览完成！\n"
        "总图文数: 2\n"
        "成功浏览: 1\n"
        "失败:     1\n"
        "图文浏览结果: 共2篇, 成功1篇, 失败1篇\n"
        "开始批量观看视频...\n"
        "准备观看 1 个视频\n"
    )
    assert p["rich_total"] == 2
    assert p["rich_success"] == 1 and p["rich_failed"] == 1
    assert p["failed"] == 0


def test_server_rate_is_only_logged_original_response():
    p = parse_original_log("开始并发观看视频\n发送心跳成功 - 位置: 60.0s/60.0s (100.0%), 事件: playing")
    assert p["simulation_percent"] == 100
    assert p["server_percent"] is None
