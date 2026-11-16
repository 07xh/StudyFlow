"""学习通本地心跳服务：Windows EXE 内 Python Sidecar 的唯一执行入口。

链路（全部在本机进程内完成，无云端托管、无网页播放器）：
  credentials.load() → adapter.list_video_tasks() → VideoTarget
  → HeartbeatSender（本地生成并发送心跳包）→ ChapterQueue（并发/暂停/恢复）
  → StateStore（断点续跑）→ 统一日志中心事件 → JSONL IPC 公开状态

IPC 输出遵循 docs/IPC_CONTRACT.md：只给公开错误码和状态，
不输出原始异常、Cookie、dtoken、enc、URL 或 Session ID。
"""
from __future__ import annotations

import hashlib
import threading
import time
import uuid
from collections import deque
from typing import Any, Callable

from . import credentials
from .heartbeat import HeartbeatSender, RateLimiter, VideoTarget, identity_from_cookies
from .pacing import VideoStatus, status_provider_from_session
from .runner import ChapterQueue, RunConfig
from .state import StateStore

OPERATIONS = frozenset({
    "xuexitong.heartbeat.start",
    "xuexitong.heartbeat.status",
    "xuexitong.heartbeat.pause",
    "xuexitong.heartbeat.resume",
    "xuexitong.heartbeat.stop",
    "xuexitong.heartbeat.logs",
})

_SESSION_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/json,*/*",
    "Referer": "https://mooc1.chaoxing.com/ananas/modules/video/index.html?v=2025-0725-1842",
}


class ServiceError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class XuexitongHeartbeatService:
    """单实例服务；所有公开方法返回可直接 JSON 序列化的 dict。"""

    def __init__(
        self,
        state_path: str,
        *,
        events_limit: int = 500,
        clock: Callable[[], float] = time.time,
        sleeper: Callable[[float], None] = time.sleep,
        session_factory: Callable[[], Any] | None = None,
        targets_provider: Callable[[str], list[Any]] | None = None,
        status_provider: Callable[[VideoTarget], VideoStatus | None] | None = None,
    ) -> None:
        self.store = StateStore(state_path)
        self._clock = clock
        self._sleeper = sleeper
        self._session_factory = session_factory
        self._targets_provider = targets_provider
        self._status_provider = status_provider
        self._events: deque[dict[str, Any]] = deque(maxlen=events_limit)
        self._lock = threading.Lock()
        self._queue: ChapterQueue | None = None
        self._thread: threading.Thread | None = None
        self._config: RunConfig | None = None
        self._course_key = ""
        self._run_id = ""
        self._account_marker = ""

    def handle(self, operation: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """JSONL IPC 分发入口。由 services/bridge.py 的 operation 白名单调用。"""
        request = payload or {}
        try:
            if operation == "xuexitong.heartbeat.start":
                return self.start(request)
            if operation == "xuexitong.heartbeat.status":
                return self.status(request.get("course_id") or request.get("course_key"))
            if operation == "xuexitong.heartbeat.pause":
                return self.pause(request.get("run_id"))
            if operation == "xuexitong.heartbeat.resume":
                return self.resume(request.get("run_id"))
            if operation == "xuexitong.heartbeat.stop":
                return self.stop(request.get("run_id"))
            if operation == "xuexitong.heartbeat.logs":
                return self.logs(int(request.get("limit", 50)), request.get("course_id"))
            raise ServiceError("XUEXITONG_UNKNOWN_OPERATION")
        except ServiceError as exc:
            return {"ok": False, "error": exc.code}
        except (ValueError, TypeError, KeyError):
            return {"ok": False, "error": "XUEXITONG_INVALID_PARAMETER"}
        except Exception:
            return {"ok": False, "error": "XUEXITONG_INTERNAL_ERROR"}

    def start(self, request: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise ServiceError("XUEXITONG_TASK_ALREADY_RUNNING")

        course_key = str(request.get("course_key") or "")
        if not course_key:
            raise ServiceError("XUEXITONG_COURSE_REQUIRED")
        # 只把请求里显式给出的参数当作 override；未给出的一律沿用 settings.py
        # 中用户保存的契约，避免「UI 保存了速度、运行器却用另一套默认值」。
        run_id = uuid.uuid4().hex
        overrides: dict[str, Any] = {"run_id": run_id}
        numeric_keys = (
            ("speed", "speed", float),
            ("jobs", "max_workers", int),
            ("heartbeat_interval_video_seconds", "heartbeat_interval_video_seconds", float),
            ("max_ticks", "max_ticks", int),
            ("max_wall_seconds", "max_wall_seconds", float),
            ("max_unconfirmed_rounds", "max_unconfirmed_rounds", int),
            ("completion_rounds", "completion_rounds", int),
        )
        for request_key, config_key, caster in numeric_keys:
            if request_key in request:
                overrides[config_key] = caster(request[request_key])
        if "instant_complete" in request:
            overrides["instant_complete"] = bool(request["instant_complete"])
        if "dtype" in request:
            overrides["dtype"] = str(request["dtype"])
        try:
            config = RunConfig.from_settings(request.get("settings"), **overrides)
        except (ValueError, TypeError, KeyError) as exc:
            raise ServiceError("XUEXITONG_INVALID_PARAMETER") from exc

        session = self._make_session()
        account_marker = self._current_account_marker()
        config.account_marker = account_marker
        config.status_provider = self._resolve_status_provider(session)
        raw_targets = self._discover_targets(course_key)
        targets: list[VideoTarget] = []
        for item in raw_targets:
            if isinstance(item, VideoTarget):
                targets.append(item)
            else:
                userid, fid = self._identity()
                targets.append(VideoTarget.from_adapter_task(item, userid=userid, fid=fid))
        if "dtype" in request:
            selected = str(request["dtype"])
            targets = [t for t in targets if getattr(t, "dtype", "Video") == selected]
            if not targets:
                raise ServiceError("XUEXITONG_NO_TARGET_FOR_DTYPE")
        for target in targets:
            try:
                target.validate()
            except ValueError as exc:
                raise ServiceError("XUEXITONG_INVALID_TARGET") from exc

        limiter = RateLimiter(clock=self._clock, sleeper=self._sleeper)
        sender = HeartbeatSender(
            session, limiter=limiter, clock=self._clock,
        )
        queue = ChapterQueue(
            sender, config, store=self.store,
            on_event=self._record, clock=self._clock, sleeper=self._sleeper,
        )
        chapters: dict[str, list[VideoTarget]] = {}
        for target in targets:
            chapters.setdefault(target.chapter_id, []).append(target)
        for chapter_id, chapter_targets in chapters.items():
            queue.submit_chapter(chapter_id, chapter_targets)

        with self._lock:
            self._queue = queue
            self._config = config
            self._course_key = course_key
            self._run_id = run_id
            self._account_marker = account_marker
            self._thread = threading.Thread(target=self._run, args=(queue,), daemon=True)
            self._thread.start()

        self._record("service.started", {
            "course_key": course_key,
            "task_count": len(targets),
            "chapter_count": len(chapters),
            "speed": config.speed,
            "jobs": config.max_workers,
            "dtype": str(request.get("dtype") or "all"),
        })
        self._sleeper(0)  # 让后台线程有机会先进入队列，status 立即读到 running
        return {
            "ok": True,
            "started": True,
            "run_id": run_id,
            "course_key": course_key,
            "task_count": len(targets),
            "chapter_count": len(chapters),
            "speed": config.speed,
            "jobs": config.max_workers,
            "instant_complete": config.instant_complete,
        }

    def wait(self, timeout: float = 5.0) -> bool:
        """等待后台队列结束；EXE 关闭与测试清理前调用，避免状态文件被并发写入。"""
        with self._lock:
            thread = self._thread
        if thread is None:
            return True
        thread.join(timeout)
        return not thread.is_alive()

    def _current_account_marker(self) -> str:
        """A pseudonymous account scope; neither user ID nor Cookie is stored."""
        if self._session_factory is not None:
            return ""
        try:
            userid, _fid = self._identity()
        except (ServiceError, ValueError):
            return "__not_signed_in__"
        return hashlib.sha256(("studyflow-xuexitong-state-v1:" + userid).encode()).hexdigest()

    def status(self, course_key: str | None = None) -> dict[str, Any]:
        if course_key is not None and (not isinstance(course_key, str) or
                                       not 1 <= len(course_key) <= 96):
            raise ServiceError("XUEXITONG_INVALID_PARAMETER")
        account_marker = self._current_account_marker()
        with self._lock:
            config = self._config
            thread = self._thread
            active_course = self._course_key
            run_id = self._run_id
            active_account = self._account_marker
        active_scope = ((course_key is None or course_key == active_course)
                        and active_account == account_marker and bool(run_id))
        running = bool(active_scope and thread is not None and thread.is_alive())
        selected_course = course_key or active_course
        if active_scope:
            snapshots = self.store.list_by_run(run_id, account_marker)
        elif selected_course:
            snapshots = self.store.list_by_course(selected_course, account_marker)
        else:
            snapshots = []
        tasks = [self._public_snapshot(item) for item in snapshots]
        return {
            "ok": True, "running": running,
            "run_id": run_id if active_scope else "",
            "course_key": selected_course,
            "config": {
                "speed": config.speed if active_scope and config else 1.0,
                "jobs": config.max_workers if active_scope and config else 2,
                "instant_complete": config.instant_complete if active_scope and config else True,
                "randomize_interval": config.randomize_interval if active_scope and config else False,
            },
            "task_count": len(tasks), "tasks": tasks,
            "heartbeats": {
                "sent": sum(item.sent_count for item in snapshots),
                "server_confirmed": sum(1 for item in snapshots if item.server_confirmed),
            },
            "queue_controls": {"pause": running, "resume": running, "stop": running},
        }

    def pause(self, run_id: str | None = None) -> dict[str, Any]:
        return self._control("pause", run_id)

    def resume(self, run_id: str | None = None) -> dict[str, Any]:
        return self._control("resume", run_id)

    def stop(self, run_id: str | None = None) -> dict[str, Any]:
        return self._control("stop", run_id)

    def logs(self, limit: int = 50, course_key: str | None = None) -> dict[str, Any]:
        # Isolate diagnostics by account and course; account marker is never exposed.
        account_marker = self._current_account_marker()
        with self._lock:
            events = [
                {key: value for key, value in event.items() if key != "_account_marker"}
                for event in self._events
                if event.get("_account_marker") == account_marker
                and (course_key is None or event.get("course_key") == course_key)
            ]
        count = max(0, min(limit, 500))
        return {"ok": True, "events": events[-count:] if count else []}

    def _control(self, action: str, run_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            queue = self._queue
            current = self._run_id
        if queue is None:
            raise ServiceError("XUEXITONG_NO_ACTIVE_TASK")
        # runner_port.py 契约：控制操作必须校验 run_id，避免控制到已替换的批次
        if run_id and current and str(run_id) != current:
            raise ServiceError("XUEXITONG_RUN_ID_MISMATCH")
        getattr(queue, f"{action}_all")()
        self._record(f"service.{action}", {"run_id": current})
        return {"ok": True, "action": action, "run_id": current}

    def _resolve_status_provider(self, session: Any):
        """生产路径才启用 /ananas/status 只读刷新；离线注入不额外发 GET。"""
        if self._status_provider is not None:
            return self._status_provider
        if self._session_factory is not None:
            return None
        try:
            _userid, fid = self._identity()
        except Exception:
            fid = "1024"
        return status_provider_from_session(session, fid)

    def _run(self, queue: ChapterQueue) -> None:
        try:
            results = queue.run()
            self._record("service.finished", {"task_count": len(results)})
        except Exception:
            self._record("service.failed", {"error": "XUEXITONG_INTERNAL_ERROR"})

    def _make_session(self) -> Any:
        if self._session_factory is not None:
            return self._session_factory()
        cookies = credentials.load()
        if not cookies:
            raise ServiceError("XUEXITONG_SESSION_MISSING")
        import requests
        session = requests.Session()
        session.cookies.update(cookies)
        session.headers.update(_SESSION_HEADERS)
        return session

    def _identity(self) -> tuple[str, str]:
        cookies = credentials.load()
        if not cookies:
            raise ServiceError("XUEXITONG_SESSION_MISSING")
        return identity_from_cookies(cookies)

    def _discover_targets(self, course_key: str) -> list[Any]:
        if self._targets_provider is not None:
            return self._targets_provider(course_key)
        from .adapter import XuexitongAdapter
        return XuexitongAdapter().list_video_tasks(course_key)

    def _record(self, event: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self._events.append({"event": event, "at": round(self._clock(), 3), **payload,
                                 "run_id": self._run_id, "course_key": self._course_key,
                                 "_account_marker": self._account_marker})

    @staticmethod
    def _public_snapshot(snapshot: Any) -> dict[str, Any]:
        return {
            "task_id": snapshot.task_id,
            "run_id": snapshot.run_id,
            "course_key": snapshot.course_key,
            "chapter": snapshot.chapter,
            "title": snapshot.title,
            "state": snapshot.state,
            "playing_time": snapshot.playing_time,
            "duration": snapshot.duration,
            "speed": snapshot.speed,
            "last_send_state": snapshot.last_send_state,
            "sent_count": snapshot.sent_count,
            "server_confirmed": snapshot.server_confirmed,
            "server_play_time": snapshot.server_play_time,
            "end_reason": snapshot.end_reason,
            "confirmed": snapshot.confirmed,
            "resumable": snapshot.resumable,
        }
