"""学习通本地心跳在长驻 Sidecar 进程内的服务单例与 operation 分发。

解决审计 P0「一次性子进程与持续任务不兼容」：
  src-tauri/src/lib.rs 的 bridge_request 对普通 operation 每次 spawn 一个
  Python 子进程、写完一行就关闭 stdin。守护线程会随该进程退出而消失。
  本项目不新建 UI，也不另起一套应用：把 xuexitong.heartbeat.* 路由到
  已有的长驻 JSONL bridge 进程（与 zhidao.qr.* 相同的持久 worker 模式），
  本模块在该进程内保存服务单例，守护线程因而能跨请求持续运行。

本模块只做分发与生命周期收尾，不含心跳算法；不输出凭据、URL、dtoken、enc。
"""
from __future__ import annotations

import atexit
import os
import threading
from pathlib import Path
from typing import Any

from studyflow.platforms.xuexitong.service import (
    OPERATIONS,
    XuexitongHeartbeatService,
)

_LOCK = threading.Lock()
_SERVICE: XuexitongHeartbeatService | None = None
_ENVELOPE_KEYS = frozenset({"id", "version", "operation"})


def state_path() -> str:
    """与 settings.py 一致落在 %LOCALAPPDATA%/StudyFlow，跨进程重启可恢复。"""
    base = Path(
        os.environ.get("LOCALAPPDATA")
        or (Path.home() / "AppData" / "Local")
    )
    return str(base / "StudyFlow" / "xuexitong-heartbeat-state-v2.json")


def get_service() -> XuexitongHeartbeatService:
    """进程内单例。长驻 bridge 进程不退出，因此后台队列线程持续存活。"""
    global _SERVICE
    with _LOCK:
        if _SERVICE is None:
            _SERVICE = XuexitongHeartbeatService(state_path())
        return _SERVICE


def dispatch(operation: str, request: dict[str, Any]) -> dict[str, Any] | None:
    """被 services/bridge.py::dispatch 调用；非心跳 operation 返回 None。

    公开字段与 service.handle 一致；失败时返回 {"ok": False, "error": 公开码}，
    由 bridge.py 转成 {"id": ..., "ok": False, "error": ...} 信封。
    """
    if operation not in OPERATIONS:
        return None
    payload = {key: value for key, value in request.items() if key not in _ENVELOPE_KEYS}
    # 统一 UI 的课程字段叫 course_id，运行器契约叫 course_key，在边界处映射
    if operation == "xuexitong.heartbeat.start" and "course_key" not in payload:
        course_id = payload.pop("course_id", None)
        if isinstance(course_id, str) and course_id:
            payload["course_key"] = course_id
    return get_service().handle(operation, payload)


def reset_for_credentials_change() -> bool:
    """Stop and release the in-memory session before account switch/logout."""
    global _SERVICE
    with _LOCK:
        service = _SERVICE
    if service is None:
        return True
    service.handle("xuexitong.heartbeat.stop", {})
    if not service.wait(20.0):
        return False
    with _LOCK:
        if _SERVICE is service:
            _SERVICE = None
    return True


def shutdown() -> None:
    """stdin EOF / 进程退出前：停止队列、等待线程收尾、确保状态落盘。"""
    with _LOCK:
        service = _SERVICE
    if service is None:
        return
    try:
        service.handle("xuexitong.heartbeat.stop", {})
    finally:
        service.wait(10.0)


atexit.register(shutdown)
