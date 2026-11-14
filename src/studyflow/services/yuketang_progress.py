"""Read bounded, redacted progress snapshots from the unchanged Rain Classroom log.

The original executor owns all heartbeat and server queries. This module only
parses lines it already wrote; it never makes requests or estimates a server rate.
A per-launch log directory ensures stale progress from earlier tasks is excluded.
"""
from __future__ import annotations

import os
from pathlib import Path
import re

RUN_ID = re.compile(r"^[0-9]{1,15}-[0-9]{1,20}$")
MAX_LOG_BYTES = 512 * 1024
FLOAT = r"([0-9]+(?:\.[0-9]+)?)"
SIMULATION = re.compile(r"发送心跳成功\s*-\s*位置:\s*" + FLOAT + r"s/" + FLOAT + r"s\s*\(" + FLOAT + r"%\)")
SERVER = re.compile(r"(服务器进度|最终进度):\s*完成率=" + FLOAT + r"%,\s*最后位置=" + FLOAT + r"s")
SERVER_INITIAL = re.compile(r"当前进度:\s*" + FLOAT + r"%,\s*最后位置:\s*" + FLOAT + r"s")
BATCH_TOTAL = re.compile(r"(?:准备观看|找到)\s*(\d+)\s*个视频")
BATCH_TEST = re.compile(r"测试模式：只处理前\s*(\d+)\s*个视频")
BATCH_CURRENT = re.compile(r"正在处理第\s*(\d+)/(\d+)\s*个视频")
BATCH_DONE = re.compile(r"\[主线程\].*?\((\d+)/(\d+)\)")
BATCH_SUMMARY = re.compile(r"^(总视频数|成功观看|跳过（已完成）|失败|手动停止):\s*(\d+)\s*$")
# The original serializer reports one worker's progress without its video ID.
# In concurrent mode, NEVER attribute these values to a particular video.


def empty_progress(available: bool = False) -> dict:
    return {
        "available": available,
        "simulation_percent": None,
        "simulation_position": None,
        "simulation_duration": None,
        "server_percent": None,
        "server_position": None,
        "server_source": None,
        "total": None,
        "processed": 0,
        "current_index": None,
        "success": 0,
        "skipped": 0,
        "failed": 0,
        "stopped": 0,
        "concurrent": None,
    }


def _number(value: str, cap: float = 10_000_000.0) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if 0 <= number <= cap else None


def parse_original_log(text: str) -> dict:
    """Produce numeric-only UI data; never expose log lines or identifiers."""
    result = empty_progress(bool(text.strip()))
    for raw in text.splitlines():
        line = raw.strip()
        if "开始并发观看视频" in line:
            result["concurrent"] = True
        elif "开始批量观看视频" in line:
            result["concurrent"] = False

        if "开始模拟观看视频" in line:
            # A new video starts: do not carry the previous video's rate forward.
            result["simulation_percent"] = None
            result["simulation_position"] = None
            result["simulation_duration"] = None
            result["server_percent"] = None
            result["server_position"] = None
            result["server_source"] = None

        match = SIMULATION.search(line)
        if match:
            position, duration, rate = (_number(v) for v in match.groups())
            if (position is not None and duration is not None and duration > 0
                    and rate is not None and rate <= 100 and position <= duration + 1):
                result["simulation_position"] = position
                result["simulation_duration"] = duration
                result["simulation_percent"] = rate

        match = SERVER.search(line)
        if match:
            label, rate_text, position_text = match.groups()
            rate, position = _number(rate_text, 100), _number(position_text)
            if rate is not None and position is not None:
                result["server_percent"] = rate
                result["server_position"] = position
                result["server_source"] = "final" if label == "最终进度" else "periodic"
        else:
            match = SERVER_INITIAL.search(line)
            if match:
                rate, position = (_number(v) for v in match.groups())
                if rate is not None and position is not None:
                    result["server_percent"] = rate
                    result["server_position"] = position
                    result["server_source"] = "initial"

        match = BATCH_TOTAL.search(line) or BATCH_TEST.search(line)
        if match:
            result["total"] = min(int(match.group(1)), 100_000)
        match = BATCH_CURRENT.search(line)
        if match:
            result["current_index"] = int(match.group(1))
            result["total"] = min(int(match.group(2)), 100_000)
        match = BATCH_DONE.search(line)
        if match:
            result["processed"] = int(match.group(1))
            result["total"] = min(int(match.group(2)), 100_000)
            if "成功完成" in line:
                result["success"] += 1
            elif "跳过已完成" in line:
                result["skipped"] += 1
            elif "已停止" in line:
                result["stopped"] += 1
            elif "失败" in line or "异常" in line:
                result["failed"] += 1
        elif result["concurrent"] is False:
            # Original sequential mode reports a completed video without a
            # [main-thread] prefix; only count terminal per-video lines.
            if "✅ 视频观看完成" in line:
                result["success"] += 1
            elif "❌ 视频观看失败" in line or "❌ 配置视频参数失败" in line:
                result["failed"] += 1
            elif "✅ 视频已完成 (" in line and "跳过" in line:
                result["skipped"] += 1
            result["processed"] = result["success"] + result["failed"] + result["skipped"]

        match = BATCH_SUMMARY.search(line)
        if match:
            field = {
                "总视频数": "total", "成功观看": "success",
                "跳过（已完成）": "skipped", "失败": "failed",
                "手动停止": "stopped",
            }[match.group(1)]
            result[field] = min(int(match.group(2)), 100_000)

    # Summary counters represent completed results, not started jobs.
    if "批量观看完成" in text or "并发观看完成" in text:
        result["processed"] = (result["success"] + result["skipped"]
                               + result["failed"] + result["stopped"])
    if result["total"] is not None:
        result["processed"] = min(result["processed"], result["total"])
    return result


def read_session_progress(run_id: str) -> dict:
    if not isinstance(run_id, str) or RUN_ID.fullmatch(run_id) is None:
        raise ValueError("INVALID_REQUEST")
    base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    path = base / "StudyFlow" / "legacy-logs" / run_id / "刷课日志.log"
    try:
        with path.open("rb") as log:
            length = log.seek(0, os.SEEK_END)
            cutoff = max(0, length - MAX_LOG_BYTES)
            log.seek(cutoff)
            data = log.read(MAX_LOG_BYTES)
            if cutoff:
                # Discard a possible partial line at the beginning of the tail.
                data = data.partition(b"\n")[2]
    except (OSError, ValueError):
        return empty_progress()
    return parse_original_log(data.decode("utf-8", errors="replace"))
