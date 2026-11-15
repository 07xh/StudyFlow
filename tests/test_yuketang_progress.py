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


def test_concurrent_worker_slots_follow_real_lifecycle_without_faking_percent():
    # Worker number is video queue position, not a permanent thread number.
    p = parse_original_log(
        "开始并发观看视频... (最大并发数: 3)\n"
        "[Worker-1] 开始处理视频: A (ID: 11)\n"
        "[Worker-2] 开始处理视频: B (ID: 22)\n"
        "[Worker-3] 开始处理视频: C (ID: 33)\n"
        "[Worker-1] 🎬 开始观看视频: A\n"
        "发送心跳成功 - 位置: 40.0s/100.0s (40.0%), 事件: playing\n"
        "[Worker-1] ✅ 视频观看完成: A\n"
        "[Worker-4] 开始处理视频: D (ID: 44)\n"
        "[Worker-4] 🎬 开始观看视频: D\n"
        "[Worker-2] ❌ 视频观看失败: B\n"
    )
    slots = p["worker_slots"]
    assert len(slots) == 3
    assert [slot["slot"] for slot in slots] == [1, 2, 3]
    assert slots[0] == {"slot": 1, "video_index": 4, "state": "watching"}
    assert slots[1] == {"slot": 2, "video_index": 2, "state": "failed"}
    assert slots[2] == {"slot": 3, "video_index": 3, "state": "preparing"}
    assert p["simulation_percent"] == 40.0
    assert all("percent" not in slot for slot in slots)
    assert "ID: 44" not in str(slots)


def test_worker_slots_unknown_if_batch_ends_without_worker_result():
    p = parse_original_log(
        "开始并发观看视频... (并发数: 2)\n"
        "[Worker-1] 开始处理视频: A\n"
        "并发观看完成！\n"
    )
    assert len(p["worker_slots"]) == 2
    assert p["worker_slots"][0]["state"] == "unknown"
    assert p["worker_slots"][1]["state"] == "waiting"


def test_per_video_observed_progress_remains_scoped_to_actual_worker():
    p = parse_original_log(
        "开始并发观看视频... (最大并发数: 2)\n"
        "准备观看 3 个视频\n"
        "[Worker-1] 开始处理视频: 第一讲 (ID: 881)\n"
        "[Worker-2] 开始处理视频: 第二讲 (ID: 882)\n"
        "[Worker-1] 🎬 开始观看视频: 第一讲\n"
        "[Worker-2] 🎬 开始观看视频: 第二讲\n"
        # Interleaved original lines must not be guessed as Worker-1 or Worker-2.
        "发送心跳成功 - 位置: 70.0s/100.0s (70.0%), 事件: playing\n"
        "服务器进度: 完成率=60.00%, 最后位置=60.0s\n"
        "[StudyFlow-Worker-2] LOCAL position=22.000 duration=100.000 percent=22.000\n"
        "[StudyFlow-Worker-1] LOCAL position=32.000 duration=80.000 percent=40.000\n"
        "[StudyFlow-Worker-2] SERVER source=periodic percent=19.500 position=19.000\n"
        "[Worker-1] ✅ 视频观看完成: 第一讲\n"
        "[Worker-3] 开始处理视频: 第三讲 (ID: 883)\n"
        "[Worker-3] ✅ 视频已完成 (95.0%): 第三讲\n"
    )
    first, second, third = p["video_tasks"]
    assert [x["video_index"] for x in p["video_tasks"]] == [1, 2, 3]
    assert first["name"] == "第一讲" and second["name"] == "第二讲"
    assert first["state"] == "completed" and first["simulation_percent"] == 40.0
    assert first["server_percent"] is None
    assert second["state"] == "watching" and second["simulation_percent"] == 22.0
    assert second["server_percent"] == 19.5 and second["server_source"] == "periodic"
    assert third["state"] == "skipped" and third["server_percent"] == 95.0
    assert "ID: 88" not in str(p["video_tasks"])
    # Global server result was deliberately cleared when the next video began.
    assert p["simulation_percent"] == 70.0 and p["server_percent"] is None


def test_missing_worker_tag_keeps_every_video_percentage_unknown():
    p = parse_original_log(
        "开始并发观看视频... (最大并发数: 3)\n"
        "[Worker-1] 开始处理视频: 视频 A (ID: 101)\n"
        "[Worker-2] 开始处理视频: 视频 B (ID: 102)\n"
        "发送心跳成功 - 位置: 95.0s/100.0s (95.0%), 事件: playing\n"
        "最终进度: 完成率=94.50%, 最后位置=94.0s\n"
        "并发观看完成！\n"
    )
    assert len(p["video_tasks"]) == 2
    assert all(x["simulation_percent"] is None and x["server_percent"] is None
               for x in p["video_tasks"])
    assert all(x["state"] == "unknown" for x in p["video_tasks"])


def test_invalid_tagged_values_cannot_create_fabricated_percent():
    p = parse_original_log(
        "开始并发观看视频... (最大并发数: 1)\n"
        "[Worker-1] 开始处理视频: 安全测试 (ID: 55)\n"
        "[StudyFlow-Worker-1] LOCAL position=1000.0 duration=10.0 percent=101.0\n"
        "[StudyFlow-Worker-1] SERVER source=final percent=105.0 position=10.0\n"
        "[StudyFlow-Worker-1] DURATION seconds=40.0\n"
    )
    row = p["video_tasks"][0]
    assert row["simulation_percent"] is None and row["server_percent"] is None
    assert row["simulation_duration"] == 40.0


def test_new_batch_resets_old_video_rows():
    p = parse_original_log(
        "开始并发观看视频... (最大并发数: 1)\n"
        "[Worker-1] 开始处理视频: 旧视频 (ID: 1)\n"
        "[StudyFlow-Worker-1] SERVER source=final percent=100 position=100\n"
        "开始并发观看视频... (最大并发数: 1)\n"
        "[Worker-1] 开始处理视频: 新视频 (ID: 2)\n"
    )
    assert p["video_tasks"][0]["name"] == "新视频"
    assert p["video_tasks"][0]["server_percent"] is None


def test_long_video_batch_retains_last_rows_without_eviction_of_active_worker():
    from studyflow.services.yuketang_progress import MAX_VIDEO_ROWS
    parts = ["开始并发观看视频... (最大并发数: 3)"]
    # Worker-1 stays active while the other queue positions finish.
    parts.append("[Worker-1] 开始处理视频: 正在执行 (ID: 1)")
    parts.append("[Worker-1] 🎬 开始观看视频: 正在执行")
    for index in range(2, MAX_VIDEO_ROWS + 12):
        parts.append(f"[Worker-{index}] 开始处理视频: 已完成 {index} (ID: {index})")
        parts.append(f"[Worker-{index}] ✅ 视频观看完成: 已完成 {index}")
    rows = parse_original_log("\n".join(parts))["video_tasks"]
    indexes = {row["video_index"] for row in rows}
    assert len(rows) == MAX_VIDEO_ROWS
    assert 1 in indexes   # Still-running worker retains its identity
    assert MAX_VIDEO_ROWS + 11 in indexes  # Most recent worker retained
    assert 2 not in indexes  # Old completed worker evicted
