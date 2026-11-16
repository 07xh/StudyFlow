"""本地心跳任务运行器：速度、暂停/恢复/停止、断点续跑、章节并发。

方案 B（独立运行器 + 状态机）落在这里；方案 A（持续任务循环）复用同一
HeartbeatSender 与 VideoTarget，不复制第二套请求逻辑。

调度原则：章内任务严格顺序，独立章节并发；单任务失败不中断队列。
完成判据：只有 SendState.CONFIRMED（服务端 isPassed=True）才置 SUCCEEDED。

审计整改（2026-11-16）：
  * 暂停期间不累计播放时间（_last_iter 在暂停等待中持续重置）。
  * 三级退出边界：墙钟总时限 / 未确认轮次上限 / 终点收尾轮次上限。
  * 队列级取消标志，停止后未启动的章节不再启动。
  * run_id 归属，历史状态可按课程与运行过滤。
  * 运行参数从 settings.py 契约映射，不再各用一套默认值。
  * 借鉴上游随机心跳间隔（30–90 视频秒）与 /ananas/status 只读校准。
"""
from __future__ import annotations

import random
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
from .pacing import (
    DEFAULT_COMPLETION_ROUNDS,
    DEFAULT_MAX_UNCONFIRMED_ROUNDS,
    DEFAULT_MAX_WALL_SECONDS,
    HEARTBEAT_MAX_VIDEO_SECONDS,
    HEARTBEAT_MIN_VIDEO_SECONDS,
    PacingPolicy,
    VideoStatus,
    calibrate_target,
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
    """自定义运行参数。速度范围对齐 settings.py v1（0.25–2.0）。"""

    speed: float = 1.0
    instant_complete: bool = False
    tick_seconds: float = 1.0
    heartbeat_interval_video_seconds: float = 60.0
    dtype: str = "Video"
    max_network_retries: int = 3
    max_forbidden_retries: int = 2
    max_ticks: int = 0
    max_workers: int = 4
    # 随机节奏与退出边界
    randomize_interval: bool = False
    min_interval_video_seconds: float = HEARTBEAT_MIN_VIDEO_SECONDS
    max_interval_video_seconds: float = HEARTBEAT_MAX_VIDEO_SECONDS
    max_wall_seconds: float = DEFAULT_MAX_WALL_SECONDS
    max_unconfirmed_rounds: int = DEFAULT_MAX_UNCONFIRMED_ROUNDS
    completion_rounds: int = DEFAULT_COMPLETION_ROUNDS
    rng: random.Random | None = None
    # 归属与只读核验
    run_id: str = ""
    account_marker: str = ""
    status_provider: Callable[[VideoTarget], VideoStatus | None] | None = None
    skip_completed: bool = True
    verify_after_run: bool = True

    def validate(self) -> None:
        if not 0.25 <= self.speed <= 2.0:
            raise ValueError("INVALID_XUEXITONG_SPEED")
        if not HEARTBEAT_MIN_VIDEO_SECONDS <= self.heartbeat_interval_video_seconds <= HEARTBEAT_MAX_VIDEO_SECONDS:
            raise ValueError("INVALID_XUEXITONG_HEARTBEAT_INTERVAL")
        if not HEARTBEAT_MIN_VIDEO_SECONDS <= self.min_interval_video_seconds <= self.max_interval_video_seconds <= HEARTBEAT_MAX_VIDEO_SECONDS:
            raise ValueError("INVALID_XUEXITONG_HEARTBEAT_INTERVAL")
        if self.tick_seconds <= 0:
            raise ValueError("INVALID_XUEXITONG_TICK")
        if self.dtype not in ("Video", "Audio"):
            raise ValueError("INVALID_XUEXITONG_DTYPE")
        if not 1 <= self.max_workers <= 4:
            raise ValueError("INVALID_XUEXITONG_JOBS")
        if self.max_network_retries < 0 or self.max_forbidden_retries < 0:
            raise ValueError("INVALID_XUEXITONG_RETRY")
        if self.max_wall_seconds <= 0 or self.max_unconfirmed_rounds < 1 or self.completion_rounds < 1:
            raise ValueError("INVALID_XUEXITONG_PACING_LIMIT")
        if self.max_ticks < 0:
            raise ValueError("INVALID_XUEXITONG_TICK")

    @classmethod
    def from_settings(
        cls,
        settings: dict[str, Any] | None = None,
        **overrides: Any,
    ) -> "RunConfig":
        """把 UI 保存的 settings.py v1 契约映射到心跳运行器。

        playback_speed -> speed；concurrency -> max_workers；
        skip_completed / verify_after_run 原样传递。生产路径默认开启
        上游式随机心跳间隔；显式 overrides 优先（供 IPC 与测试使用）。
        """
        raw = settings
        if raw is None:
            try:
                from .settings import read as read_settings
                raw = read_settings()
            except ImportError:
                # Sidecar 单文件打包或离线测试时可能没有 settings.py；
                # 退到与 settings.DEFAULTS 完全一致的契约，不引入新默认值。
                raw = {
                    "playback_speed": 1.0, "concurrency": 2,
                    "skip_completed": True, "verify_after_run": True,
                }
        config = cls(
            speed=float(raw.get("playback_speed", 1.0)),
            max_workers=int(raw.get("concurrency", 2)),
            skip_completed=bool(raw.get("skip_completed", True)),
            verify_after_run=bool(raw.get("verify_after_run", True)),
            randomize_interval=True,
            rng=random.Random(),
        )
        for key, value in overrides.items():
            if value is not None and hasattr(config, key):
                setattr(config, key, value)
        config.validate()
        return config

    def pacing(self) -> PacingPolicy:
        return PacingPolicy(
            min_interval_video_seconds=self.min_interval_video_seconds,
            max_interval_video_seconds=self.max_interval_video_seconds,
            fallback_interval_video_seconds=self.heartbeat_interval_video_seconds,
            max_wall_seconds=self.max_wall_seconds,
            max_unconfirmed_rounds=self.max_unconfirmed_rounds,
            completion_rounds=self.completion_rounds,
            rng=self.rng,
        )

    def next_interval(self) -> float:
        if not self.randomize_interval:
            return self.heartbeat_interval_video_seconds
        return self.pacing().next_interval()


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
        cancel_event: threading.Event | None = None,
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
        self._cancel_event = cancel_event
        self._paused = threading.Event()
        self._stopped = threading.Event()
        self._started = False
        self._ticks = 0
        self._network_retries = 0
        self._forbidden_retries = 0
        self._last_iter = clock()
        self._paused_wall = 0.0
        self._snapshot = TaskSnapshot(
            task_id=target.task_id,
            run_id=config.run_id,
            account_marker=config.account_marker,
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
        # UI-only estimate, never written to the resume state file.
        self._runtime_playing_time = float(self._snapshot.playing_time)

    @property
    def snapshot(self) -> TaskSnapshot:
        return TaskSnapshot(**self._snapshot.__dict__.copy())

    @property
    def status_snapshot(self) -> TaskSnapshot:
        """Live local-time view, not evidence of playback or server completion."""
        item = self.snapshot
        if item.state in (TaskState.RUNNING.value, TaskState.PAUSED.value):
            item.playing_time = max(
                item.playing_time,
                min(item.duration, int(self._runtime_playing_time)),
            )
        return item

    @property
    def state(self) -> str:
        return self._snapshot.state

    def pause(self) -> None:
        if self._stopped.is_set() or self._is_terminal():
            return
        # A queue may pause between runner registration and start().
        # Latch the request even before _started becomes true.
        self._paused.set()
        if self._started:
            self._transition(TaskState.PAUSED)

    def resume(self) -> None:
        if not self._paused.is_set() or self._stopped.is_set():
            return
        self._paused.clear()
        self._last_iter = self._clock()
        if self._started:
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
        if self._paused.is_set():
            self._transition(TaskState.PAUSED)
        # Respect a pause/stop latched before this runner entered start().
        if not self._wait_while_paused():
            return self.snapshot
        self._calibrate_from_server()
        if self._is_terminal() or not self._wait_while_paused():
            return self.snapshot

        # 首包：直接申报整段时长 / 完成状态（上游 study_video 的瞬间完成路径）。
        # 这是虚构完成包，只用于试探服务端是否接受；不得污染本地渐进进度，
        # 否则 speed / 心跳间隔 / 暂停计时会全部失效。
        if self.config.instant_complete and self._snapshot.playing_time < self.target.duration:
            result = self._send(
                build_completion_packet(self.target, dtype=getattr(self.target, "dtype", self.config.dtype)),
                apply_progress=False,
            )
            if result.completed:
                # 服务端已确认：把展示进度对齐到申报值；未确认时仍不污染本地进度
                self._snapshot.playing_time = result.playing_time
                self._finish(TaskState.SUCCEEDED, "confirmed")
                return self.snapshot
            if result.state.fatal:
                self._finish(TaskState.FAILED, result.state.value)
                return self.snapshot

        play_time = float(self._snapshot.playing_time)
        self._runtime_playing_time = play_time
        last_log_time = play_time
        self._last_iter = self._clock()
        start_wall = self._clock()
        self._paused_wall = 0.0
        wait_time = self.config.next_interval()
        duration = float(self.target.duration)
        unconfirmed_rounds = 0
        completion_rounds = 0

        while not self._stopped.is_set() and not self._cancelled():
            if not self._wait_while_paused():
                break

            now = self._clock()
            play_time = min(duration, play_time + (now - self._last_iter) * self.config.speed)
            self._runtime_playing_time = play_time
            self._last_iter = now
            # 墙钟总时限只统计实际运行时间，暂停等待不计入（审计 P1）
            if now - start_wall - self._paused_wall > self.config.max_wall_seconds:
                self._finish(TaskState.INTERRUPTED, "wall_timeout")
                return self.snapshot
            at_end = play_time >= duration

            if play_time - last_log_time >= wait_time or at_end:
                packet = build_packet(
                    self.target, int(play_time), completion=at_end,
                    dtype=getattr(self.target, "dtype", self.config.dtype),
                )
                result = self._send(packet)
                if result.completed:
                    self._finish(TaskState.SUCCEEDED, "confirmed")
                    return self.snapshot
                if result.state.fatal or not self._allow_retry(result.state):
                    self._finish(TaskState.FAILED, result.state.value)
                    return self.snapshot
                unconfirmed_rounds += 1
                if unconfirmed_rounds >= self.config.max_unconfirmed_rounds:
                    self._finish(TaskState.INTERRUPTED, "unconfirmed_limit")
                    return self.snapshot
                if at_end:
                    completion_rounds += 1
                    if completion_rounds >= self.config.completion_rounds:
                        self._finish(TaskState.INTERRUPTED, "completion_unconfirmed")
                        return self.snapshot
                wait_time = self.config.next_interval()
                last_log_time = play_time
                self._snapshot.playing_time = int(play_time)

            if not self._consume_tick():
                self._finish(TaskState.INTERRUPTED, "tick_limit")
                return self.snapshot
            self._sleeper(self.config.tick_seconds)

        return self.snapshot

    def _calibrate_from_server(self) -> None:
        """启动前只读刷新：用服务端 dtoken/duration/playTime 校准本地目标。"""
        provider = self.config.status_provider
        if provider is None:
            return
        status = provider(self.target)
        if status is None:
            self._emit("heartbeat.calibration_unavailable", {"task_id": self.target.task_id})
            return
        self._snapshot.server_play_time = status.play_time
        self._emit("heartbeat.calibrated", {"task_id": self.target.task_id, **status.public_dict()})
        if status.passed and self.config.skip_completed:
            self._snapshot.server_confirmed = True
            self._finish(TaskState.SUCCEEDED, "server_already_passed")
            return
        calibrated = calibrate_target(self.target, status)
        if calibrated != self.target:
            self.target = calibrated
            self._snapshot.duration = calibrated.duration
            self._snapshot.playing_time = max(self._snapshot.playing_time, calibrated.initial_seconds)

    def _verify_at_end(self, reason: str) -> bool:
        """结束时用只读 status 接口核对服务端记录；返回是否已被服务端判定通过。

        本地申报成功（sent / reported）与服务端正式记录是两个口径，
        这里只用 status 纠正任务级终态，不推断整门课程是否完成。
        """
        if reason in ("server_already_passed", "confirmed"):
            return False
        if not self.config.verify_after_run or self.config.status_provider is None:
            return False
        status = self.config.status_provider(self.target)
        if status is None:
            self._emit("heartbeat.verification_unavailable", {"task_id": self.target.task_id})
            return False
        self._snapshot.server_play_time = status.play_time
        if status.passed:
            self._snapshot.server_confirmed = True
        self._emit("heartbeat.verified", {"task_id": self.target.task_id, **status.public_dict()})
        return status.passed

    def _send(self, packet: Any, *, apply_progress: bool = True) -> HeartbeatResult:
        result = self.sender.send(packet)
        if result.state is SendState.FORBIDDEN:
            result = self._recover_after_forbidden(packet, result)
        self._snapshot.sent_count += int(result.sent)
        self._snapshot.attempts += result.attempts
        self._snapshot.last_send_state = result.state.value
        self._snapshot.server_confirmed = self._snapshot.server_confirmed or result.server_confirmed
        if apply_progress:
            self._snapshot.playing_time = max(self._snapshot.playing_time, result.playing_time)
        self._persist()
        self._emit("heartbeat.sent", result.public_dict())
        return result

    def _recover_after_forbidden(self, packet: Any, result: HeartbeatResult) -> HeartbeatResult:
        """借鉴上游 _recover_after_forbidden：403 后刷新 dtoken/duration/playTime 再重试。

        上游还会更新会话 cookie；本项目凭据由 credentials 统一管理，
        这里只做只读刷新 + rt 回退重试，不改动登录态。
        """
        provider = self.config.status_provider
        if provider is None or self._forbidden_retries >= self.config.max_forbidden_retries:
            return result
        self._forbidden_retries += 1
        status = provider(self.target)
        if status is None or not status.usable:
            self._emit("heartbeat.recovery_unavailable", {"task_id": self.target.task_id})
            return result
        calibrated = calibrate_target(self.target, status)
        self.target = calibrated
        self._snapshot.duration = calibrated.duration
        self._snapshot.server_play_time = status.play_time
        self._emit("heartbeat.recovered", {
            "task_id": self.target.task_id,
            "attempt": self._forbidden_retries,
            **status.public_dict(),
        })
        return self.sender.send_with_rt_fallback(
            self.target,
            min(packet.playing_time, calibrated.duration),
            completion=packet.claims_completion,
            dtype=packet.dtype,
        )

    def _allow_retry(self, state: SendState) -> bool:
        if state is SendState.NETWORK_ERROR:
            self._network_retries += 1
            return self._network_retries <= self.config.max_network_retries
        if state is SendState.FORBIDDEN:
            self._forbidden_retries += 1
            return self._forbidden_retries <= self.config.max_forbidden_retries
        return True

    def _cancelled(self) -> bool:
        return self._cancel_event is not None and self._cancel_event.is_set()

    def _wait_while_paused(self) -> bool:
        while self._paused.is_set() and not self._stopped.is_set() and not self._cancelled():
            before = self._clock()
            # Paused time must not consume the execution tick budget.
            self._sleeper(self.config.tick_seconds)
            now = self._clock()
            # 暂停期间既不计入播放时间，也不计入墙钟超时预算
            self._paused_wall += max(0.0, now - before)
            self._last_iter = now
        return not self._stopped.is_set() and not self._cancelled()

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

    def _finish(self, state: TaskState, reason: str = "") -> None:
        # 服务端只读记录优先：本地判中断/失败，但 status 已通过时纠正为成功
        verified_passed = self._verify_at_end(reason)
        effective = TaskState.SUCCEEDED if verified_passed else state
        self._snapshot.state = effective.value
        self._snapshot.confirmed = effective is TaskState.SUCCEEDED
        self._snapshot.end_reason = reason
        self._snapshot.updated_at = self._clock()
        self._persist()
        self._emit("task.finished", {
            "task_id": self.target.task_id,
            "run_id": self._snapshot.run_id,
            "state": effective.value,
            "end_reason": reason,
            "server_confirmed": self._snapshot.server_confirmed,
            "server_play_time": self._snapshot.server_play_time,
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
        self._cancelled = threading.Event()
        self._paused = threading.Event()

    def submit_chapter(self, chapter_id: str, targets: list[VideoTarget]) -> bool:
        with self._lock:
            if chapter_id in self._chapters:
                return False
            self._chapters[chapter_id] = list(targets)
            return True

    @property
    def paused(self) -> bool:
        """Expose queue-wide suspension without allowing callers to mutate it."""
        return self._paused.is_set()

    def pause_all(self) -> None:
        # The queue-wide flag prevents not-yet-started chapters from running.
        self._paused.set()
        for runner in self._current_runners():
            runner.pause()

    def resume_all(self) -> None:
        self._paused.clear()
        for runner in self._current_runners():
            runner.resume()

    def stop_all(self) -> None:
        """队列级取消：先置标志，未启动的章节不会再创建运行器。"""
        self._cancelled.set()
        self._paused.clear()
        for runner in self._current_runners():
            runner.stop()
        if self._on_event is not None:
            self._on_event("queue.cancelled", {})

    def reset(self) -> None:
        """显式复位取消标志；仅在新建运行批次时调用，run() 不自动清除。"""
        self._cancelled.clear()
        self._paused.clear()

    def _wait_for_queue_resume(self) -> bool:
        # wait() on the cancel event also lets stop_all wake a paused queue.
        while self._paused.is_set() and not self._cancelled.is_set():
            self._cancelled.wait(0.1)
        return not self._cancelled.is_set()

    def run(self) -> dict[str, TaskSnapshot]:
        # 不清除 _cancelled：stop_all() 可能先于工作线程进入 run()，
        # 自动 clear 会让「启动后立即停止」失效（审计 P1）。
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
            if not self._wait_for_queue_resume():
                break
            target.validate()
            resumed = self.store.load(target.task_id, self.config.account_marker) if self.store is not None else None
            # 断点只在同一课程内恢复，禁止把别的课程/批次的进度带进本任务
            resume_at = (
                resumed.playing_time
                if resumed and resumed.resumable and resumed.course_key == target.course_key
                else None
            )
            runner = HeartbeatTaskRunner(
                target,
                self.sender,
                self.config,
                store=self.store,
                on_event=self._on_event,
                clock=self._clock,
                sleeper=self._sleeper,
                resume_playing_time=resume_at,
                cancel_event=self._cancelled,
            )
            with self._lock:
                self._runners[target.task_id] = runner
            # pause_all might have raced with registration. Its queue flag
            # remains set until resume_all, so latch a pre-start pause here.
            if self._paused.is_set():
                runner.pause()
            snapshots.append(runner.start())
        return snapshots


    def status_snapshots(self, *, running: bool) -> list[TaskSnapshot]:
        """Read-only status of every scheduled task, including never-started chapters.

        The persistent state store only contains tasks after runner.start(); it
        cannot describe queued chapters. These synthetic pending snapshots are
        returned to the UI only and are never written to disk.
        """
        with self._lock:
            chapters = [(chapter, tuple(targets)) for chapter, targets in self._chapters.items()]
            runners = dict(self._runners)
        items: list[TaskSnapshot] = []
        for _chapter, targets in chapters:
            for target in targets:
                runner = runners.get(target.task_id)
                if runner is not None:
                    snapshot = runner.status_snapshot
                    # A terminated queue must not appear to be still running.
                    if not running and snapshot.state in ("running", "paused", "pending"):
                        snapshot.state = "interrupted"
                    items.append(snapshot)
                    continue
                items.append(TaskSnapshot(
                    task_id=target.task_id,
                    run_id=self.config.run_id,
                    account_marker=self.config.account_marker,
                    course_key=target.course_key,
                    chapter_id=target.chapter_id,
                    chapter=target.chapter,
                    title=target.title,
                    duration=target.duration,
                    speed=self.config.speed,
                    state="pending" if running and not self._cancelled.is_set() else "not_started",
                ))
        return items

    def _current_runners(self) -> list[HeartbeatTaskRunner]:
        with self._lock:
            return list(self._runners.values())
