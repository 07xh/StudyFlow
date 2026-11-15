"""Read-only attribution of the original Rain Classroom worker log lines.

The legacy executor prints video progress without a Worker-N prefix.  During
its *already isolated* child process we append a second, numeric-only line
when a print originates inside a named worker stack frame. The original print,
HTTP requests, heartbeat generator, timings, and original main.py are unchanged.
"""
from __future__ import annotations

import builtins
from contextlib import contextmanager
import re
import sys

_FLOAT = r"([0-9]+(?:\.[0-9]+)?)"
_LOCAL = re.compile(
    r"发送心跳成功\s*-\s*位置:\s*" + _FLOAT + r"s/" + _FLOAT
    + r"s\s*\(" + _FLOAT + r"%\)"
)
_SERVER = re.compile(
    r"(服务器进度|最终进度):\s*完成率=" + _FLOAT
    + r"%,\s*最后位置=" + _FLOAT + r"s"
)
_INITIAL = re.compile(
    r"当前进度:\s*" + _FLOAT + r"%,\s*最后位置:\s*" + _FLOAT + r"s"
)
_DURATION = re.compile(r"^\s*视频时长:\s*" + _FLOAT + r"秒\s*$")


def _worker_index() -> int | None:
    """The actual original worker owns the stack; never infer from timing."""
    try:
        frame = sys._getframe(2)
        for _ in range(32):
            if frame is None:
                break
            if frame.f_code.co_name == "watch_single_video_worker":
                worker = frame.f_locals.get("worker_id")
                if type(worker) is int and 1 <= worker <= 100_000:
                    return worker
                return None
            frame = frame.f_back
    except (ValueError, AttributeError):
        return None
    finally:
        # Avoid holding stack frames or their local credentials beyond this call.
        frame = None
    return None


def _safe_number(value: str, cap: float) -> str | None:
    try:
        number = float(value)
    except (ValueError, TypeError):
        return None
    if not (0 <= number <= cap):
        return None
    # Only numeric data crosses the observation boundary; no raw log payload.
    return f"{number:.3f}"


def _numeric_annotation(message: str) -> str | None:
    match = _LOCAL.search(message)
    if match:
        values = [_safe_number(s, 10_000_000) for s in match.groups()[:2]]
        rate = _safe_number(match.group(3), 100)
        if all(v is not None for v in values) and rate is not None:
            position, duration = values
            if 0 < float(duration) and float(position) <= float(duration) + 1:
                return f"LOCAL position={position} duration={duration} percent={rate}"
    match = _SERVER.search(message)
    if match:
        label, percent, position = match.groups()
        rate = _safe_number(percent, 100)
        pos = _safe_number(position, 10_000_000)
        if rate is not None and pos is not None:
            source = "final" if label == "最终进度" else "periodic"
            return f"SERVER source={source} percent={rate} position={pos}"
    match = _INITIAL.search(message)
    if match:
        rate = _safe_number(match.group(1), 100)
        pos = _safe_number(match.group(2), 10_000_000)
        if rate is not None and pos is not None:
            return f"SERVER source=initial percent={rate} position={pos}"
    match = _DURATION.search(message)
    if match:
        duration = _safe_number(match.group(1), 10_000_000)
        if duration is not None and float(duration) > 0:
            return f"DURATION seconds={duration}"
    return None


@contextmanager
def attribute_worker_progress():
    """Annotate only attributable lines, restoring print even on task failure.

    This runs exclusively in the original worker's own isolated sidecar
    subprocess. The additional lines contain Worker index and bounded numbers,
    never cookies, URLs, IDs, video titles, error text or arbitrary payloads.
    """
    original_print = builtins.print

    def observed_print(*args, **kwargs):
        original_print(*args, **kwargs)
        try:
            # Preserve all original arguments, destinations and behavior. Do not
            # duplicate arbitrary stderr text or interleaved multi-arg output.
            if len(args) != 1 or not isinstance(args[0], str):
                return
            if kwargs.get("file") not in (None, sys.stdout):
                return
            annotation = _numeric_annotation(args[0])
            if annotation is None:
                return
            index = _worker_index()
            if index is not None:
                original_print(f"[StudyFlow-Worker-{index}] {annotation}", flush=True)
        except Exception:
            # Observability must never affect the original player state.
            return

    builtins.print = observed_print
    try:
        yield
    finally:
        builtins.print = original_print
