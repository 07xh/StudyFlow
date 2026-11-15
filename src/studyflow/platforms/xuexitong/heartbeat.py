"""本地学习进度心跳包：生成、发送、响应分类。

执行位置：Windows EXE 内打包的 Python Sidecar，不经云端托管，不依赖网页播放器。

算法来源（GPL-3.0，见 docs/XUEXITONG_LOCAL_HEARTBEAT.md 溯源表）：
  Samueli924/chaoxing  api/base.py  get_enc() / video_progress_log() / study_video()
  lispringing/SuperStar api/base.py  get_enc() / video_progress_log()  （同源校验）

本模块只保留「心跳包构造 + 本地发送 + 结果分类」，删去上游的题库、通知、
Captcha OCR、tqdm 终端进度条等无关功能；上游 2s 限流与 rt 回退策略保留。

核心契约：
  sent             = 本地请求已发出并收到 HTTP 响应
  server_confirmed = 服务端返回 200 且 isPassed == True
  两者严格分离；REPORTED（200 但 isPassed=False）绝不视为任务完成。
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Protocol

ENC_SALT = "d_yHJ!$pdA~5"
LOG_URL_TEMPLATE = "https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/{cpi}/{dtoken}"
STATUS_URL_TEMPLATE = "https://mooc1.chaoxing.com/ananas/status/{object_id}"
VIDEO_HEADERS = {
    "Referer": "https://mooc1.chaoxing.com/ananas/modules/video/index.html?v=2025-0725-1842",
}
AUDIO_HEADERS = {
    "Referer": "https://mooc1.chaoxing.com/ananas/modules/audio/index_new.html?v=2025-0725-1842",
}
_RT_PATTERN = re.compile(r"-rt_([1d])")
_CAPTCHA_MARKERS = ("验证码", "validate")
_SESSION_MARKERS = ("passport2.chaoxing.com", "login.chaoxing.com")
_RT_FALLBACKS = ("0.9", "1")

# 上游：video_log_limiter = RateLimiter(2)，limit_rate(random_time=True, random_max=2)
LOG_MIN_INTERVAL_S = 2.0
LOG_JITTER_S = 2.0
REQUEST_TIMEOUT_S: tuple[float, float] = (5.0, 12.0)


class SendState(str, Enum):
    """一次心跳的终态。UI 与任务中心只消费这里的公开状态。"""

    CONFIRMED = "confirmed"              # 200 + isPassed True，服务端确认完成
    REPORTED = "reported"                # 200 + isPassed False，包已发出但未完成
    FORBIDDEN = "forbidden"              # 403，风控/rt 不匹配
    CAPTCHA = "captcha"                  # 触发验证码
    SESSION_EXPIRED = "session_expired"  # 返回登录页
    PROTOCOL_ERROR = "protocol_error"    # 200 但响应结构不可解析
    HTTP_ERROR = "http_error"            # 其他非 200
    NETWORK_ERROR = "network_error"      # 连接层失败
    INVALID_TARGET = "invalid_target"    # 本地参数校验失败，未发包

    @property
    def retryable(self) -> bool:
        return self in (
            SendState.REPORTED, SendState.NETWORK_ERROR,
            SendState.HTTP_ERROR, SendState.PROTOCOL_ERROR,
        )

    @property
    def fatal(self) -> bool:
        return self in (
            SendState.FORBIDDEN, SendState.CAPTCHA,
            SendState.SESSION_EXPIRED, SendState.INVALID_TARGET,
        )


@dataclass(frozen=True)
class VideoTarget:
    """心跳目标。字段与 adapter.VideoTask 一一对应，附加会话身份。"""

    course_key: str
    chapter_id: str
    chapter: str
    title: str
    clazz_id: str
    course_id: str
    cpi: str
    job_id: str
    object_id: str
    other_info: str
    duration: int
    initial_seconds: int
    dtoken: str
    rt: float = 0.0
    face_enc: str = ""
    att_duration_enc: str = ""
    att_duration: int = 0
    userid: str = ""
    fid: str = "1024"

    @property
    def task_id(self) -> str:
        return f"{self.course_key}:{self.chapter_id}:{self.object_id}:{self.job_id}"

    @classmethod
    def from_adapter_task(cls, task: Any, *, userid: str, fid: str = "1024") -> "VideoTarget":
        """把开发分支 adapter.list_video_tasks() 的结果转换成本模块目标。"""
        return cls(
            course_key=getattr(task, "course_key", ""),
            chapter_id=getattr(task, "chapter_id", ""),
            chapter=getattr(task, "chapter", ""),
            title=getattr(task, "title", ""),
            clazz_id=getattr(task, "clazz_id", ""),
            course_id=getattr(task, "course_id", ""),
            cpi=getattr(task, "cpi", ""),
            job_id=getattr(task, "job_id", ""),
            object_id=getattr(task, "object_id", ""),
            other_info=getattr(task, "other_info", ""),
            duration=int(getattr(task, "duration", 0)),
            initial_seconds=int(getattr(task, "initial_seconds", 0)),
            dtoken=getattr(task, "dtoken", ""),
            rt=float(getattr(task, "rt", 0.0) or 0.0),
            face_enc=getattr(task, "face_enc", ""),
            att_duration_enc=getattr(task, "att_duration_enc", ""),
            userid=userid,
            fid=fid,
        )

    def validate(self) -> None:
        required = (
            self.clazz_id, self.course_id, self.cpi, self.job_id,
            self.object_id, self.other_info, self.dtoken, self.userid,
        )
        if not all(isinstance(v, str) and v for v in required):
            raise ValueError("INCOMPLETE_XUEXITONG_TARGET")
        if self.duration <= 0:
            raise ValueError("INVALID_XUEXITONG_DURATION")
        if not 0 <= self.initial_seconds <= self.duration:
            raise ValueError("INVALID_XUEXITONG_INITIAL_SECONDS")
        if "courseId" in self.other_info:
            raise ValueError("INVALID_XUEXITONG_OTHERINFO")


@dataclass(frozen=True)
class HeartbeatPacket:
    """一个完整、可直接 GET 的进度心跳包。"""

    url: str
    params: dict[str, Any]
    headers: dict[str, str]
    task_id: str
    playing_time: int
    duration: int
    isdrag: int
    dtype: str

    @property
    def claims_completion(self) -> bool:
        """该包是否在申报「已看完 / 已完成」。"""
        return self.playing_time >= self.duration and self.isdrag == 4


@dataclass(frozen=True)
class HeartbeatResult:
    """单次心跳的本地发送结果与服务端确认结果，分开记录。"""

    state: SendState
    sent: bool
    server_confirmed: bool
    http_status: int | None
    task_id: str
    playing_time: int
    duration: int
    sent_at: float
    response_excerpt: str = ""
    rt: str | None = None
    attempts: int = 1

    @property
    def completed(self) -> bool:
        return self.state is SendState.CONFIRMED

    def public_dict(self) -> dict[str, Any]:
        """IPC/UI 出口：只给公开状态，不输出 URL、cookie、dtoken、enc。"""
        return {
            "state": self.state.value,
            "sent": self.sent,
            "server_confirmed": self.server_confirmed,
            "http_status": self.http_status,
            "task_id": self.task_id,
            "playing_time": self.playing_time,
            "duration": self.duration,
            "rt": self.rt,
            "attempts": self.attempts,
            "sent_at": round(self.sent_at, 3),
        }


class ResponseLike(Protocol):
    status_code: int
    text: str

    def json(self) -> Any: ...


class SessionLike(Protocol):
    def get(
        self,
        url: str,
        *,
        params: dict[str, Any],
        headers: dict[str, str],
        timeout: tuple[float, float],
    ) -> ResponseLike: ...


def get_timestamp_ms() -> str:
    return str(int(time.time() * 1000))


def build_enc(
    clazz_id: str,
    job_id: str,
    object_id: str,
    playing_time: int,
    duration: int,
    userid: str,
) -> str:
    """复现上游 get_enc()：MD5 拼串，字节级一致。

    原文：f"[{clazzId}][{userid}][{jobid}][{objectId}][{playingTime * 1000}]"
         f"[d_yHJ!$pdA~5][{duration * 1000}][0_{duration}]"
    """
    playing_time = int(playing_time)
    duration = int(duration)
    raw = (
        f"[{clazz_id}][{userid}][{job_id}][{object_id}]"
        f"[{playing_time * 1000}][{ENC_SALT}][{duration * 1000}][0_{duration}]"
    )
    return hashlib.md5(raw.encode()).hexdigest()


def resolve_rt(target: VideoTarget) -> str:
    """上游策略：优先 job.rt，其次从 otherInfo 的 -rt_1 / -rt_d 推导。"""
    if target.rt:
        return str(target.rt)
    match = _RT_PATTERN.search(target.other_info)
    if match:
        return "0.9" if match.group(1) == "d" else "1"
    return ""


def build_packet(
    target: VideoTarget,
    playing_time: int,
    *,
    completion: bool = False,
    dtype: str = "Video",
    rt: str | None = None,
    timestamp_ms: str | None = None,
    isdrag: int | None = None,
) -> HeartbeatPacket:
    """构造心跳包。

    completion=True  → 申报完成状态：playingTime 直接置为 duration，isdrag=4。
    playing_time     → 任意申报观看时长，允许小于/等于 duration。
    两者都只生成本地数据包，是否生效以服务端 isPassed 为准。
    """
    target.validate()
    if dtype not in ("Video", "Audio"):
        raise ValueError("INVALID_XUEXITONG_DTYPE")
    playing_time = int(playing_time)
    duration = int(target.duration)
    if not 0 <= playing_time <= duration:
        raise ValueError("INVALID_XUEXITONG_PLAYING_TIME")
    if completion:
        playing_time = duration
        drag = 4 if isdrag is None else isdrag
    else:
        drag = 3 if isdrag is None else isdrag

    effective_rt = resolve_rt(target) if rt is None else rt
    enc = build_enc(
        target.clazz_id, target.job_id, target.object_id,
        playing_time, duration, target.userid,
    )
    params: dict[str, Any] = {
        "clazzId": target.clazz_id,
        "playingTime": playing_time,
        "duration": duration,
        "clipTime": f"0_{duration}",
        "objectId": target.object_id,
        "otherInfo": target.other_info,
        "courseId": target.course_id,
        "jobid": target.job_id,
        "userid": target.userid,
        "isdrag": drag,
        "view": "pc",
        "enc": enc,
        "dtype": dtype,
    }
    if target.face_enc:
        params["videoFaceCaptureEnc"] = target.face_enc
    if target.att_duration:
        params["attDuration"] = target.att_duration
    if target.att_duration_enc:
        params["attDurationEnc"] = target.att_duration_enc
    if effective_rt:
        params["rt"] = effective_rt
    params["_t"] = timestamp_ms or get_timestamp_ms()

    return HeartbeatPacket(
        url=LOG_URL_TEMPLATE.format(cpi=target.cpi, dtoken=target.dtoken),
        params=params,
        headers=dict(VIDEO_HEADERS if dtype == "Video" else AUDIO_HEADERS),
        task_id=target.task_id,
        playing_time=playing_time,
        duration=duration,
        isdrag=drag,
        dtype=dtype,
    )


def build_completion_packet(target: VideoTarget, **kwargs: Any) -> HeartbeatPacket:
    """上游 study_video() 的首包：直接申报整段时长，可瞬间完成视频任务。"""
    return build_packet(target, target.duration, completion=True, **kwargs)


class RateLimiter:
    """上游 RateLimiter 的等价实现：线程安全、支持注入时钟与休眠。"""

    def __init__(
        self,
        call_interval: float = LOG_MIN_INTERVAL_S,
        *,
        clock: Callable[[], float] = time.time,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.call_interval = call_interval
        self._clock = clock
        self._sleeper = sleeper
        self._last_call = clock()
        self._lock = threading.Lock()

    def limit_rate(self, random_time: bool = True, random_max: float = LOG_JITTER_S) -> None:
        with self._lock:
            now = self._clock()
            base_wait = max(self._last_call + self.call_interval - now, 0.0)
            extra = random.uniform(0.0, random_max) if random_time else 0.0
            wait = base_wait + extra
            self._last_call = now + wait
        if wait > 0:
            self._sleeper(wait)


def identity_from_cookies(cookies: dict[str, str]) -> tuple[str, str]:
    """从 credentials.load() 的结果提取 userid 与 fid。"""
    userid = cookies.get("_uid") or cookies.get("UID") or ""
    fid = cookies.get("fid") or "1024"
    if not userid:
        raise ValueError("XUEXITONG_SESSION_MISSING")
    return str(userid), str(fid)


class HeartbeatSender:
    """本地网络请求发送器。不含凭据读取，session 由调用方注入。"""

    def __init__(
        self,
        session: SessionLike,
        *,
        limiter: RateLimiter | None = None,
        clock: Callable[[], float] = time.time,
        sleeper: Callable[[float], None] = time.sleep,
        timeout: tuple[float, float] = REQUEST_TIMEOUT_S,
    ) -> None:
        self._session = session
        self._limiter = limiter or RateLimiter(clock=clock, sleeper=sleeper)
        self._clock = clock
        self._timeout = timeout

    def send(self, packet: HeartbeatPacket, *, attempts: int = 1) -> HeartbeatResult:
        """发出一个心跳包并分类响应。"""
        self._limiter.limit_rate()
        sent_at = self._clock()
        try:
            response = self._session.get(
                packet.url,
                params=packet.params,
                headers=packet.headers,
                timeout=self._timeout,
            )
        except Exception as exc:  # requests 抛出的连接层异常在本层收敛为公开状态
            return self._result(
                SendState.NETWORK_ERROR, packet, sent_at,
                sent=False, http_status=None,
                excerpt=type(exc).__name__, attempts=attempts,
            )

        status = int(getattr(response, "status_code", 0) or 0)
        text = (getattr(response, "text", "") or "")[:2000]
        state = self._classify(response, status, text)
        confirmed = state is SendState.CONFIRMED
        return self._result(
            state, packet, sent_at,
            sent=True, http_status=status,
            excerpt=text[:300], attempts=attempts,
            confirmed=confirmed,
        )

    def send_with_rt_fallback(
        self,
        target: VideoTarget,
        playing_time: int,
        **kwargs: Any,
    ) -> HeartbeatResult:
        """rt 缺失时按上游顺序尝试 0.9 / 1，任一 200 即返回该结果。"""
        rt = kwargs.pop("rt", None) or resolve_rt(target)
        if rt:
            return self.send(build_packet(target, playing_time, rt=rt, **kwargs))
        last: HeartbeatResult | None = None
        for index, candidate in enumerate(_RT_FALLBACKS, start=1):
            packet = build_packet(target, playing_time, rt=candidate, **kwargs)
            last = self.send(packet, attempts=index)
            # 上游在 403 时切换 rt 继续尝试，只有会话/验证码类失败才提前终止
            if last.http_status == 200 or last.state in (
                SendState.CAPTCHA, SendState.SESSION_EXPIRED, SendState.INVALID_TARGET,
            ):
                return last
        assert last is not None
        return last

    @staticmethod
    def _classify(response: ResponseLike, status: int, text: str) -> SendState:
        if status == 403:
            return SendState.FORBIDDEN
        if any(marker in text for marker in _CAPTCHA_MARKERS):
            return SendState.CAPTCHA
        if any(marker in text for marker in _SESSION_MARKERS):
            return SendState.SESSION_EXPIRED
        if status != 200:
            return SendState.HTTP_ERROR
        try:
            payload = response.json() if hasattr(response, "json") else json.loads(text)
        except (ValueError, TypeError, AttributeError):
            return SendState.PROTOCOL_ERROR
        if not isinstance(payload, dict) or "isPassed" not in payload:
            return SendState.PROTOCOL_ERROR
        return SendState.CONFIRMED if payload["isPassed"] is True else SendState.REPORTED

    @staticmethod
    def _result(
        state: SendState,
        packet: HeartbeatPacket,
        sent_at: float,
        *,
        sent: bool,
        http_status: int | None,
        excerpt: str,
        attempts: int,
        confirmed: bool = False,
    ) -> HeartbeatResult:
        return HeartbeatResult(
            state=state,
            sent=sent,
            server_confirmed=confirmed,
            http_status=http_status,
            task_id=packet.task_id,
            playing_time=packet.playing_time,
            duration=packet.duration,
            sent_at=sent_at,
            response_excerpt=excerpt,
            rt=str(packet.params.get("rt", "")) or None,
            attempts=attempts,
        )
