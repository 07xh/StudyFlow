"""模拟心跳节奏与服务端状态校准。

借鉴上游 Samueli924/chaoxing（GPL-3.0）api/base.py::study_video：
  * 每次上报后重新抽取 wait_time = random.uniform(30, 90) 个「视频秒」，
    而不是固定间隔；心跳间隔以视频时间计，不是墙钟时间。
  * 403 之后通过 /ananas/status/{objectId}?k={fid}&flag=normal 刷新
    dtoken / duration / playTime，用服务端真实记录校准本地累计值。
  * 首包 isdrag=4 申报整段完成，后续 isdrag=3 汇报当前进度。

本模块不发送进度包，只提供节奏策略、只读状态解析和校准结果。
所有网络读取都是只读 GET，可用假 session 完整离线测试。
"""
from __future__ import annotations

import random
from dataclasses import dataclass, replace
from typing import Any, Callable, Protocol
from urllib.parse import quote

from .heartbeat import STATUS_URL_TEMPLATE, VIDEO_HEADERS, VideoTarget

HEARTBEAT_MIN_VIDEO_SECONDS = 30.0
HEARTBEAT_MAX_VIDEO_SECONDS = 90.0
DEFAULT_MAX_WALL_SECONDS = 3600.0
DEFAULT_MAX_UNCONFIRMED_ROUNDS = 12
DEFAULT_COMPLETION_ROUNDS = 3
STATUS_TIMEOUT_S: tuple[float, float] = (5.0, 12.0)


class StatusResponseLike(Protocol):
    status_code: int
    text: str

    def json(self) -> Any: ...


class StatusSessionLike(Protocol):
    def get(
        self,
        url: str,
        *,
        params: dict[str, Any],
        headers: dict[str, str],
        timeout: tuple[float, float],
    ) -> StatusResponseLike: ...


@dataclass(frozen=True)
class VideoStatus:
    """服务端 /ananas/status 的只读快照。play_time 统一为秒。"""

    object_id: str
    dtoken: str
    duration: int
    play_time: int
    passed: bool

    @property
    def usable(self) -> bool:
        return bool(self.dtoken) and self.duration > 0

    def public_dict(self) -> dict[str, Any]:
        """IPC 出口：不含 dtoken、URL、cookie。"""
        return {
            "object_id": self.object_id,
            "duration": self.duration,
            "server_play_time": self.play_time,
            "server_passed": self.passed,
        }


def _as_seconds(value: Any, duration: int) -> int:
    """上游 playTime 有时是毫秒、有时是秒；按「是否超过时长」自适应。

    旧的 duration*100 阈值会把 30 秒（30000ms）误判成 30000 秒再 clamp 到
    duration；只要数值大于总时长就按毫秒降级，直到落回秒区间。
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    while number > duration and number >= 1000:
        number /= 1000.0
    return min(int(number), duration)


def parse_video_status(payload: Any, object_id: str) -> VideoStatus | None:
    if not isinstance(payload, dict) or payload.get("status") != "success":
        return None
    try:
        duration = int(payload.get("duration") or 0)
    except (TypeError, ValueError):
        return None
    if duration <= 0:
        return None
    return VideoStatus(
        object_id=object_id,
        dtoken=str(payload.get("dtoken") or ""),
        duration=duration,
        play_time=_as_seconds(payload.get("playTime") or 0, duration),
        passed=payload.get("isPassed") is True,
    )


def fetch_video_status(
    session: StatusSessionLike,
    object_id: str,
    fid: str = "1024",
    *,
    timeout: tuple[float, float] = STATUS_TIMEOUT_S,
    headers: dict[str, str] | None = None,
) -> VideoStatus | None:
    """只读刷新视频元数据；任何异常都降级为 None，不阻断任务状态机。"""
    url = STATUS_URL_TEMPLATE.format(object_id=quote(object_id, safe=""))
    try:
        response = session.get(
            url,
            params={"k": fid, "flag": "normal"},
            headers=dict(headers or VIDEO_HEADERS),
            timeout=timeout,
        )
    except Exception:
        return None
    if int(getattr(response, "status_code", 0) or 0) != 200:
        return None
    try:
        payload = response.json() if hasattr(response, "json") else None
    except (ValueError, TypeError, AttributeError):
        return None
    return parse_video_status(payload, object_id)


def calibrate_target(target: VideoTarget, status: VideoStatus) -> VideoTarget:
    """用服务端记录校准本地目标，只允许前进不允许回退。"""
    if not status.usable:
        return target
    return replace(
        target,
        dtoken=status.dtoken or target.dtoken,
        duration=status.duration,
        initial_seconds=min(status.duration, max(target.initial_seconds, status.play_time)),
    )


def reconcile_playing_time(local: int, status: VideoStatus | None) -> int:
    """本地累计与服务端记录的并集：取较大值，且不超过服务端时长。"""
    if status is None:
        return max(0, int(local))
    return min(status.duration, max(0, int(local), status.play_time))


@dataclass
class PacingPolicy:
    """心跳节奏与退出边界。

    max_wall_seconds        : 单任务墙钟总时限，防止无限循环
    max_unconfirmed_rounds  : 连续未获服务端确认的上报轮次上限
    completion_rounds       : 本地到终点后仍允许申报完成的轮次上限
    """

    min_interval_video_seconds: float = HEARTBEAT_MIN_VIDEO_SECONDS
    max_interval_video_seconds: float = HEARTBEAT_MAX_VIDEO_SECONDS
    fallback_interval_video_seconds: float = 60.0
    max_wall_seconds: float = DEFAULT_MAX_WALL_SECONDS
    max_unconfirmed_rounds: int = DEFAULT_MAX_UNCONFIRMED_ROUNDS
    completion_rounds: int = DEFAULT_COMPLETION_ROUNDS
    rng: random.Random | None = None

    def __post_init__(self) -> None:
        self.rng = self.rng or random.Random()
        self.validate()

    def validate(self) -> None:
        if not HEARTBEAT_MIN_VIDEO_SECONDS <= self.min_interval_video_seconds <= self.max_interval_video_seconds <= HEARTBEAT_MAX_VIDEO_SECONDS:
            raise ValueError("INVALID_XUEXITONG_HEARTBEAT_INTERVAL")
        if self.max_wall_seconds <= 0 or self.max_unconfirmed_rounds < 1 or self.completion_rounds < 1:
            raise ValueError("INVALID_XUEXITONG_PACING_LIMIT")

    def next_interval(self) -> float:
        """上游行为：每次上报后重新随机 30–90 视频秒。"""
        return float(self.rng.uniform(  # type: ignore[union-attr]
            self.min_interval_video_seconds, self.max_interval_video_seconds,
        ))


def status_provider_from_session(
    session: StatusSessionLike,
    fid: str = "1024",
) -> Callable[[VideoTarget], VideoStatus | None]:
    """把刷新逻辑包装成可注入 runner 的回调。"""
    def provider(target: VideoTarget) -> VideoStatus | None:
        return fetch_video_status(session, target.object_id, fid)
    return provider
