"""心跳任务状态持久化：断点续跑，且不落盘任何凭据或令牌。

v2 新增 run_id / server_play_time / end_reason，并保留 v1 记录的读取兼容。
查询接口支持按课程与按运行过滤，避免不同课程、不同任务批次的数据混入统计。
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import asdict, dataclass
from typing import Any

_SNAPSHOT_FIELDS = frozenset({
    "task_id", "run_id", "account_marker", "course_key", "chapter_id", "chapter", "title", "object_id",
    "job_id", "duration", "playing_time", "speed", "state", "last_send_state",
    "sent_count", "confirmed", "server_confirmed", "server_play_time", "end_reason",
    "attempts", "updated_at",
})

STATE_VERSION = 2
LEGACY_STATE_VERSION = 1


@dataclass
class TaskSnapshot:
    """可恢复的任务快照。刻意不含 dtoken / cookie / enc / userid。"""

    task_id: str
    run_id: str = ""
    account_marker: str = ""  # Hash-derived scope, never the account ID itself.
    course_key: str = ""
    chapter_id: str = ""
    chapter: str = ""
    title: str = ""
    object_id: str = ""
    job_id: str = ""
    duration: int = 0
    playing_time: int = 0
    speed: float = 1.0
    state: str = "pending"
    last_send_state: str = ""
    sent_count: int = 0
    confirmed: bool = False
    server_confirmed: bool = False
    server_play_time: int = 0
    end_reason: str = ""
    attempts: int = 0
    updated_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["version"] = STATE_VERSION
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TaskSnapshot":
        if data.get("version") not in (STATE_VERSION, LEGACY_STATE_VERSION):
            raise ValueError("UNSUPPORTED_XUEXITONG_STATE_VERSION")
        return cls(**{key: data[key] for key in _SNAPSHOT_FIELDS if key in data})

    @property
    def resumable(self) -> bool:
        return self.state in (
            "paused", "pending", "running", "failed", "interrupted",
        ) and not self.server_confirmed


class StateStore:
    """JSON 文件状态库，原子替换写入，可跨进程重启恢复。"""

    def __init__(self, path: str) -> None:
        self.path = os.fspath(path)
        self._lock = threading.Lock()
        parent = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(parent, exist_ok=True)

    @staticmethod
    def _key(task_id: str, account_marker: str = "") -> str:
        # Legacy account-less tests remain readable; production states are
        # namespaced and cannot overwrite another account's same task ID.
        return f"{account_marker}:{task_id}" if account_marker else task_id

    def save(self, snapshot: TaskSnapshot) -> None:
        with self._lock:
            data = self._read()
            data[self._key(snapshot.task_id, snapshot.account_marker)] = snapshot.to_dict()
            self._write(data)

    def load(self, task_id: str, account_marker: str = "") -> TaskSnapshot | None:
        data = self._read()
        record = data.get(self._key(task_id, account_marker))
        if not isinstance(record, dict):
            return None
        try:
            return TaskSnapshot.from_dict(record)
        except (ValueError, TypeError, KeyError):
            return None

    def list_all(self) -> list[TaskSnapshot]:
        data = self._read()
        result: list[TaskSnapshot] = []
        for record in data.values():
            if not isinstance(record, dict):
                continue
            try:
                result.append(TaskSnapshot.from_dict(record))
            except (ValueError, TypeError, KeyError):
                continue
        return result

    def list_resumable(self, *, course_key: str | None = None) -> list[TaskSnapshot]:
        return [
            item for item in self.list_all()
            if item.resumable and (course_key is None or item.course_key == course_key)
        ]

    def list_by_course(self, course_key: str, account_marker: str | None = None) -> list[TaskSnapshot]:
        return [item for item in self.list_all() if item.course_key == course_key
                and (account_marker is None or item.account_marker == account_marker)]

    def list_by_run(self, run_id: str, account_marker: str | None = None) -> list[TaskSnapshot]:
        return [item for item in self.list_all() if item.run_id == run_id
                and (account_marker is None or item.account_marker == account_marker)]

    def clear(self, task_id: str, account_marker: str = "") -> None:
        with self._lock:
            data = self._read()
            data.pop(self._key(task_id, account_marker), None)
            self._write(data)

    def _read(self) -> dict[str, Any]:
        if not os.path.exists(self.path):
            return {}
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write(self, data: dict[str, Any]) -> None:
        payload = json.dumps(data, ensure_ascii=False, sort_keys=True)
        fd, temp_path = tempfile.mkstemp(
            prefix="xxt-state-", suffix=".tmp",
            dir=os.path.dirname(os.path.abspath(self.path)),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.path)
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
