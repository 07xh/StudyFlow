"""本地心跳任务运行器：速度、暂停/恢复/停止、断点续跑、章节并发。

方案 B（独立运行器 + 状态机）落在这里；方案 A（持续任务循环）复用同一
HeartbeatSender 与 VideoTarget，不复制第二套请求逻辑。

调度原则：章内任务严格顺序，独立章节并发；单任务失败不中断队列。
完成判据：只有 SendState.CONFIRMED（服务端 isPassed=True）才置 SUCCEEDED。
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable

from .heartbeat import (
    HeartbeatResult,
    HeartbeatSender,
    SendState,
    VideoTarget,
    build_completion_packet,
    build_packet,
)
from .state import StateStore, TaskSnapshot

EventSink = Callable[[str, dict[str, Any]], None]


class TaskState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    STOPPED = "stopped"
    INTERRUPTED = "interrupted"


@dataclass
class RunConfig:
    """自定义运行参数。速度上限与心跳间隔对应上游实测值。"""

    speed: float = 1.0                                # 1.0–2.0，上游 max=2
    instant_complete: bool = True                     # 首包直接申报完成状态
    tick_seconds: float = 1.0                         # 上游 gc.THRESHOLD
    heartbeat_interval_video_seconds: float = 60.0    # 上游 random.uniform(30, 90)
    dtype: str = "Video"
    max_network_retries: int = 3
    max_forbidden_retries: int = 2
    max_ticks: int = 0                                # 0 = 不限；测试/限时使用
    max_workers: int = 4                              # 上游 jobs = 4

    def validate(self) -> None:
        if not 1.0 <= self.speed <= 2.0:
            raise ValueError("INVALID_XUEXITONG_SPEED")
        if not 30.0 <= self.heartbeat_interval_video_seconds <= 90.0:
            raise ValueError("INVALID_XUEXITONG_HEARTBEAT_INTERVAL")
        if self.tick_seconds <= 0:
            raise ValueError("INVALID_XUEXITONG_TICK")
        if self.dtype not in ("Video", "Audio"):
            raise ValueError("INVALID_XUEXITONG_DTYPE")
        if self.max_workers < 1:
            raise ValueError("INVALID_XUEXITONG_JOBS")
        if self.max_network_retries < 0 or self.max_forbidden_retries < 0:
            raise ValueError("INVALID_XUEXITONG_RETRY")


class HeartbeatTaskRunner:
    """单视频任务的独立状态机。start() 阻塞直到任务终结或被控制。"""

    def __init__(
        self,
        target: VideoTarget,
        sender: HeartbeatSender,
        config: RunConfig | None = None,
        *,
        store: StateStore | None = None,
        on_event: EventSink | None = None,
        clock: Callable[[], float] = time.time,
        sleeper: Callable[[float], None] = time.sleep,
        resume_playing_time: int | None = None,
    ) -> None:
        config = config or RunConfig()
        config.validate()
        target.validate()
        self.target = target
        self.sender = sender
        self.config = config
        self.store = store
        self._on_event = on_event
        self._clock = clock
        self._sleeper = sleeper
        self._paused = threading.Event()
        self._stopped = threading.Event()
        self._started = False
        self._ticks = 0
        self._network_retries = 0
        self._forbidden_retries = 0
        self._snapshot = TaskSnapshot(
            task_id=target.task_id,
            course_key=target.course_key,
            chapter_id=target.chapter_id,
            chapter=target.chapter,
            title=target.title,
            object_id=target.object_id,
            job_id=target.job_id,
            duration=target.duration,
            playing_time=(
                resume_playing_time
                if resume_playing_time is not None
                else target.initial_seconds
            ),
            speed=config.speed,
            state=TaskState.PENDING.value,
            updated_at=clock(),
        )

    @property
    def snapshot(self) -> TaskSnapshot:
        return TaskSnapshot(**self._snapshot.__dict__.copy())

    @property
    def state(self) -> str:
        return self._snapshot.state

    def pause(self) -> None:
        if not self._started or self._stopped.is_set() or self._is_terminal():
            return
        self._paused.set()
        self._transition(TaskState.PAUSED)

    def resume(self) -> None:
        if not self._paused.is_set() or self._stopped.is_set():
            return
        self._paused.clear()
        self._transition(TaskState.RUNNING)

    def stop(self) -> None:
        if not self._started or self._is_terminal():
            return
        self._stopped.set()
        self._paused.clear()
        self._transition(TaskState.STOPPED)

    def start(self) -> TaskSnapshot:
        if self._started:
            raise RuntimeError("XUEXITONG_TASK_ALREADY_STARTED")
        self._started = True
        self._transition(TaskState.RUNNING)

        # 首包：直接申报整段时长 / 完成状态（上游 study_video 的瞬间完成路径）
        if self.config.instant_complete and self._snapshot.playing_time < self.target.duration:
            result = self._send(build_completion_packet(self.target, dtype=self.config.dtype))
            if result.completed:
                self._finish(TaskState.SUCCEEDED)
                return self.snapshot
            if result.state.fatal:
                self._finish(TaskState.FAILED)
                return self.snapshot
            self._snapshot.playing_time = min(self._snapshot.playing_time, result.playing_time)

        play_time = float(self._snapshot.playing_time)
        last_log_time = play_time
        last_iter = self._clock()
        wait_time = self.config.heartbeat_interval_video_seconds
        duration = float(self.target.duration)

        while not self._stopped.is_set():
            if not self._wait_while_paused():
                break

            now = self._clock()
            play_time = min(duration, play_time + (now - last_iter) * self.config.speed)
            last_iter = now
            at_end = play_time >= duration

            if play_time - last_log_time >= wait_time or at_end:
                packet = build_packet(
                    self.target,
                    int(play_time),
                    completion=at_end,
                    dtype=self.config.dtype,
                )
                result = self._send(packet)
                if result.completed:
                    self._finish(TaskState.SUCCEEDED)
                    return self.snapshot
                if result.state.fatal or not self._allow_retry(result.state):
                    self._finish(TaskState.FAILED)
                    return self.snapshot
                wait_time = self.config.heartbeat_interval_video_seconds
                last_log_time = play_time
                self._snapshot.playing_time = int(play_time)

            if not self._consume_tick():
                self._finish(TaskState.INTERRUPTED)
                return self.snapshot
            self._sleeper(self.config.tick_seconds)

        return self.snapshot

    def _send(self, packet: Any) -> HeartbeatResult:
        result = self.sender.send(packet)
        self._snapshot.sent_count += 1
        self._snapshot.attempts += result.attempts
        self._snapshot.last_send_state = result.state.value
        self._snapshot.server_confirmed = result.server_confirmed
        self._snapshot.playing_time = max(self._snapshot.playing_time, result.playing_time)
        self._persist()
        self._emit("heartbeat.sent", result.public_dict())
        return result

    def _allow_retry(self, state: SendState) -> bool:
        if state is SendState.NETWORK_ERROR:
            self._network_retries += 1
            return self._network_retries <= self.config.max_network_retries
        if state is SendState.FORBIDDEN:
            self._forbidden_retries += 1
            return self._forbidden_retries <= self.config.max_forbidden_retries
        return True  # REPORTED / PROTOCOL_ERROR / HTTP_ERROR：继续推进播放时间

    def _wait_while_paused(self) -> bool:
        while self._paused.is_set() and not self._stopped.is_set():
            if not self._consume_tick():
                return False
            self._sleeper(self.config.tick_seconds)
        return not self._stopped.is_set()

    def _consume_tick(self) -> bool:
        self._ticks += 1
        if self.config.max_ticks and self._ticks >= self.config.max_ticks:
            return False
        return True

    def _is_terminal(self) -> bool:
        return self._snapshot.state in (
            TaskState.SUCCEEDED.value, TaskState.FAILED.value,
            TaskState.STOPPED.value, TaskState.INTERRUPTED.value,
        )

    def _transition(self, state: TaskState) -> None:
        self._snapshot.state = state.value
        self._snapshot.updated_at = self._clock()
        self._persist()
        self._emit("task.state", {"task_id": self.target.task_id, "state": state.value})

    def _finish(self, state: TaskState) -> None:
        self._snapshot.state = state.value
        self._snapshot.confirmed = state is TaskState.SUCCEEDED
        self._snapshot.updated_at = self._clock()
        self._persist()
        self._emit("task.finished", {
            "task_id": self.target.task_id,
            "state": state.value,
            "server_confirmed": self._snapshot.server_confirmed,
            "playing_time": self._snapshot.playing_time,
            "duration": self._snapshot.duration,
        })

    def _persist(self) -> None:
        if self.store is not None:
            self.store.save(self.snapshot)

    def _emit(self, event: str, payload: dict[str, Any]) -> None:
        if self._on_event is not None:
            self._on_event(event, payload)


class ChapterQueue:
    """章节并发队列：章内顺序，章间并发，单任务失败隔离，防重复启动。"""

    def __init__(
        self,
        sender: HeartbeatSender,
        config: RunConfig | None = None,
        *,
        store: StateStore | None = None,
        on_event: EventSink | None = None,
        clock: Callable[[], float] = time.time,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.sender = sender
        self.config = config or RunConfig()
        self.config.validate()
        self.store = store
        self._on_event = on_event
        self._clock = clock
        self._sleeper = sleeper
        self._lock = threading.Lock()
        self._chapters: dict[str, list[VideoTarget]] = {}
        self._runners: dict[str, HeartbeatTaskRunner] = {}

    def submit_chapter(self, chapter_id: str, targets: list[VideoTarget]) -> bool:
        with self._lock:
            if chapter_id in self._chapters:
                return False
            self._chapters[chapter_id] = list(targets)
            return True

    def pause_all(self) -> None:
        for runner in self._current_runners():
            runner.pause()

    def resume_all(self) -> None:
        for runner in self._current_runners():
            runner.resume()

    def stop_all(self) -> None:
        for runner in self._current_runners():
            runner.stop()

    def run(self) -> dict[str, TaskSnapshot]:
        with self._lock:
            chapters = dict(self._chapters)
        results: dict[str, TaskSnapshot] = {}
        with ThreadPoolExecutor(max_workers=self.config.max_workers) as pool:
            futures = {
                chapter_id: pool.submit(self._run_chapter, chapter_id, targets)
                for chapter_id, targets in chapters.items()
            }
            for chapter_id, future in futures.items():
                try:
                    for snapshot in future.result():
                        results[snapshot.task_id] = snapshot
                except Exception as exc:
                    if self._on_event is not None:
                        self._on_event("chapter.failed", {
                            "chapter_id": chapter_id,
                            "error": type(exc).__name__,
                        })
        return results

    def _run_chapter(self, chapter_id: str, targets: list[VideoTarget]) -> list[TaskSnapshot]:
        snapshots: list[TaskSnapshot] = []
        for target in targets:
            target.validate()
            resumed = self.store.load(target.task_id) if self.store is not None else None
            resume_at = resumed.playing_time if resumed and resumed.resumable else None
            runner = HeartbeatTaskRunner(
                target,
                self.sender,
                self.config,
                store=self.store,
                on_event=self._on_event,
                clock=self._clock,
                sleeper=self._sleeper,
                resume_playing_time=resume_at,
            )
            with self._lock:
                self._runners[target.task_id] = runner
            snapshots.append(runner.start())
        return snapshots

    def _current_runners(self) -> list[HeartbeatTaskRunner]:
        with self._lock:
            return list(self._runners.values())
