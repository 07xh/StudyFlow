"""StudyFlow U校园AI 5.0 fabricated media heartbeat wire contract.

No official player, no media decoding and no real watched seconds are used.
StudyFlow invents a playback timeline locally, emits Socket.IO activity
heartbeats for the intermediate invented positions, and submits the
upstream-verified "mark seen" packet (``submitType=2``) as the final
heartbeat so the platform records the resource as completed.

Reused upstream evidence (licenses and pinned commits are recorded in
``docs/UCAMPUS_INTEGRATION.md``):

* ``Zzj-klwgxdz/UnipusAI`` @ 937725e (GPL-3.0)
  ``src/api/session.rs::submit_url``, ``src/api/submit.rs::build_mark_seen_payload``
  / ``is_rate_limited``, ``src/api/course.rs::LeafState.pass`` /
  ``LeafEntry.duration``, ``src/core/runner.rs`` (180s escalating cooldown).
* ``create-try-now/AutoFinish_UxiaoyuanAI`` @ main (Apache-2.0)
  ``submit()`` cooldown retry and ``courseProgress`` ``pass/pass2/perm`` readback.
* ``ACaiCat/UnipusHelper.NET`` @ 3e8492f (MIT)
  ``Protocol.cs`` -> ``submitType = preset || video-popup ? 2 : 1``.
* ``z5882852/unipus-tool`` @ main (no LICENSE; structural reference only)
  ``ws.py`` -> ``["start", {...}]`` emitted every 20 seconds without a player.
  Its code is NOT copied; StudyFlow's ``socketio_client.py`` is an independent
  Engine.IO v3 implementation with TLS verification enabled.

Only the wire *contract* is reused. This module is an original implementation.
"""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

CONTENT_ORIGIN = "https://ucontent.unipus.cn"
SUBMIT_PATH = "/course/api/v3/newExploration/submit"
PROGRESS_PATH = "/course/api/v2/course_progress/{course}/{unit}/{open_id}/default/"
SOCKET_NAMESPACE = "/userActivities"
MARK_SEEN_URL = CONTENT_ORIGIN + SUBMIT_PATH

_ID_RE = re.compile(r"^[A-Za-z0-9_:-]{1,128}$")
RATE_LIMIT_CODES = frozenset((600001, 600002))
RATE_LIMIT_MESSAGE = "操作过于频繁"
SESSION_CODES = frozenset((401, 403, 100001, 100002))

DEFAULT_DURATION_SECONDS = 600.0
MIN_DURATION_SECONDS = 1.0
MAX_DURATION_SECONDS = 36000.0
MAX_PULSES = 100
DEFAULT_HEARTBEAT_INTERVAL = 20.0  # z5882852/unipus-tool ws.py default t=20
DEFAULT_COOLDOWN_SECONDS = 180.0   # UnipusAI runner.rs escalating cooldown
MAX_RATE_LIMIT_RETRIES = 5         # UnipusAI runner.rs

# build_mark_seen_payload() key order in UnipusAI src/api/submit.rs.
MARK_SEEN_KEYS = (
    "quesDatas", "groupId", "isCompleted", "thirdPartyJudges", "submitType",
    "hideLoading", "associationGroupId", "courseId", "openId", "version",
)


class FabricatedSendState(str, Enum):
    """Local report vs. platform acknowledgement remain strictly separated."""

    SENT = "sent"                          # heartbeat frame written to socket
    ACCEPTED = "accepted"                  # completion POST responded code=0
    CONFIRMED = "confirmed"                # code=0 AND readback pass flag set
    RATE_LIMITED = "rate_limited"          # 600001/600002 or 操作过于频繁
    REJECTED = "rejected"                  # code != 0, explicit server refusal
    SESSION_EXPIRED = "session_expired"
    PROTOCOL_ERROR = "protocol_error"
    NETWORK_ERROR = "network_error"
    SOCKET_UNVERIFIED = "socket_unverified"  # socket reply is never proof


@dataclass(frozen=True)
class FabricatedTarget:
    """A real platform resource id plus a locally invented duration."""

    course_id: str
    unit_id: str
    resource_id: str
    title: str = ""
    duration_seconds: float = DEFAULT_DURATION_SECONDS
    dtype: str = "video"
    tab_type: str = ""
    version: str = "default"
    open_id: str = ""
    module: str = ""
    module_group: str = ""
    tag1: str = ""
    tag2: str = ""
    page_url: str = ""

    def validate(self) -> None:
        for value in (self.course_id, self.unit_id, self.resource_id,
                      self.version, self.open_id):
            if not isinstance(value, str) or (value and not _ID_RE.fullmatch(value)):
                raise ValueError("UCAMPUS_INVALID_FABRICATED_TARGET")
        for value in (self.course_id, self.unit_id, self.resource_id):
            if not value:
                raise ValueError("UCAMPUS_INVALID_FABRICATED_TARGET")
        if not isinstance(self.title, str) or len(self.title) > 200:
            raise ValueError("UCAMPUS_INVALID_FABRICATED_TARGET")
        if (not isinstance(self.duration_seconds, (int, float))
                or isinstance(self.duration_seconds, bool)
                or not math.isfinite(self.duration_seconds)
                or not MIN_DURATION_SECONDS <= self.duration_seconds <= MAX_DURATION_SECONDS):
            raise ValueError("UCAMPUS_INVALID_FABRICATED_TARGET")
        if self.dtype not in ("video", "audio"):
            raise ValueError("UCAMPUS_INVALID_FABRICATED_TARGET")
        for value in (self.tab_type, self.module, self.module_group,
                      self.tag1, self.tag2, self.page_url):
            if not isinstance(value, str) or len(value) > 512:
                raise ValueError("UCAMPUS_INVALID_FABRICATED_TARGET")

    @classmethod
    def from_progress_row(cls, course_id: str, unit_id: str,
                          row: Mapping[str, Any], *, open_id: str = "",
                          duration_seconds: float = DEFAULT_DURATION_SECONDS,
                          title_prefix: str = "") -> "FabricatedTarget":
        """Build from ``UCampusProgressReader.list_tasks()`` output.

        Legacy Socket.IO activity fields are derived from the real ids, not
        from a browser player: ``module``/``tag2`` use the resource id and
        ``moduleGroup`` uses the course id (ws.py used tutorial/unit ids).
        """
        resource_id = str(row.get("id") or "")
        dtype = "audio" if str(row.get("type") or "").lower() == "audio" else "video"
        raw_duration = row.get("duration")
        try:
            duration = float(raw_duration) if raw_duration is not None else float(duration_seconds)
        except (TypeError, ValueError):
            duration = float(duration_seconds)
        if not math.isfinite(duration) or duration <= 0:
            duration = float(duration_seconds)
        duration = min(MAX_DURATION_SECONDS, max(MIN_DURATION_SECONDS, duration))
        module = resource_id
        target = cls(
            course_id=course_id, unit_id=unit_id, resource_id=resource_id,
            title=str(row.get("title") or resource_id),
            duration_seconds=duration, dtype=dtype,
            tab_type=str(row.get("type") or ""), open_id=open_id,
            module=module, module_group=course_id,
            tag1=unit_id, tag2=resource_id,
            page_url=(f"{CONTENT_ORIGIN}/_explorationpc_default/pc.html"
                      f"#/{course_id}/{unit_id}/{resource_id}"),
        )
        target.validate()
        return target


@dataclass(frozen=True)
class FabricatedPulse:
    """One locally invented playback position. Never derived from a player."""

    run_id: str
    course_id: str
    unit_id: str
    resource_id: str
    sequence: int
    total_pulses: int
    position_seconds: float
    duration_seconds: float
    completion: bool
    dtype: str = "video"
    open_id: str = ""
    issued_at: str = ""

    def progress(self) -> float:
        if self.duration_seconds <= 0:
            return 0.0
        return min(1.0, max(0.0, self.position_seconds / self.duration_seconds))


class FabricatedTimeline:
    """Linear virtual playback from 0 to duration over N invented heartbeats.

    ``speed`` scales the local wall-clock interval only; virtual seconds
    always advance linearly and are independent of real elapsed time.
    """

    def __init__(self, target: FabricatedTarget, pulses: int, *, speed: float = 1.0):
        target.validate()
        if type(pulses) is not int or not 1 <= pulses <= MAX_PULSES:
            raise ValueError("UCAMPUS_INVALID_FABRICATED_PARAMETER")
        if (not isinstance(speed, (int, float)) or isinstance(speed, bool)
                or not math.isfinite(speed) or not 0.25 <= speed <= 16.0):
            raise ValueError("UCAMPUS_INVALID_FABRICATED_PARAMETER")
        self.target = target
        self.pulses = pulses
        self.speed = float(speed)
        self.step = target.duration_seconds / pulses

    def position(self, sequence: int) -> float:
        if type(sequence) is not int or not 1 <= sequence <= self.pulses:
            raise ValueError("UCAMPUS_INVALID_FABRICATED_SEQUENCE")
        if sequence == self.pulses:
            return round(self.target.duration_seconds, 3)
        return round(min(self.target.duration_seconds, self.step * sequence), 3)

    def is_completion(self, sequence: int) -> bool:
        return sequence == self.pulses

    def make_pulse(self, sequence: int, run_id: str) -> FabricatedPulse:
        if not isinstance(run_id, str) or not 1 <= len(run_id) <= 64:
            raise ValueError("UCAMPUS_INVALID_FABRICATED_TARGET")
        return FabricatedPulse(
            run_id=run_id, course_id=self.target.course_id,
            unit_id=self.target.unit_id, resource_id=self.target.resource_id,
            sequence=sequence, total_pulses=self.pulses,
            position_seconds=self.position(sequence),
            duration_seconds=round(self.target.duration_seconds, 3),
            completion=self.is_completion(sequence), dtype=self.target.dtype,
            open_id=self.target.open_id,
            issued_at=datetime.now(timezone.utc).isoformat(),
        )

    def wall_interval(self, base_interval: float = DEFAULT_HEARTBEAT_INTERVAL) -> float:
        """Real seconds between two fabricated heartbeats."""
        if (not isinstance(base_interval, (int, float)) or isinstance(base_interval, bool)
                or not math.isfinite(base_interval) or base_interval <= 0):
            raise ValueError("UCAMPUS_INVALID_FABRICATED_PARAMETER")
        return max(0.05, float(base_interval) / self.speed)


def _identifier(value: Any, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not value and not allow_empty):
        raise ValueError("UCAMPUS_INVALID_FABRICATED_PAYLOAD")
    if value and not _ID_RE.fullmatch(value):
        raise ValueError("UCAMPUS_INVALID_FABRICATED_PAYLOAD")
    return value


def build_activity_event(pulse: Any, target: FabricatedTarget | None = None) -> dict[str, Any]:
    """Intermediate fabricated heartbeat payload (Socket.IO ``start`` event).

    Structure follows z5882852/unipus-tool ``ws.py``: a locally constructed
    activity frame, no media element and no playback evidence. The invented
    position/duration are local bookkeeping only and are never sent as an
    invented U校园 HTTP endpoint.
    """
    course_id = _identifier(pulse.course_id)
    unit_id = _identifier(pulse.unit_id)
    resource_id = _identifier(pulse.resource_id)
    if target is not None:
        target.validate()
        module = target.module or resource_id
        module_group = target.module_group or course_id
        tag1 = target.tag1 or unit_id
        tag2 = target.tag2 or resource_id
        page_url = target.page_url or (f"{CONTENT_ORIGIN}/_explorationpc_default/pc.html"
                                       f"#/{course_id}/{unit_id}/{resource_id}")
    else:
        module, module_group, tag1, tag2 = resource_id, course_id, unit_id, resource_id
        page_url = (f"{CONTENT_ORIGIN}/_explorationpc_default/pc.html"
                    f"#/{course_id}/{unit_id}/{resource_id}")
    position = float(pulse.position_seconds)
    duration = float(pulse.duration_seconds)
    if (not math.isfinite(position) or not math.isfinite(duration)
            or not 0 <= position <= duration <= MAX_DURATION_SECONDS):
        raise ValueError("UCAMPUS_INVALID_FABRICATED_PAYLOAD")
    return {
        "module": module,
        "moduleGroup": module_group,
        "client": "U校园pc",
        "url": page_url,
        "tag1": tag1,
        "tag2": tag2,
    }


def build_mark_seen_payload(pulse: Any) -> dict[str, Any]:
    """Final fabricated heartbeat: the upstream-exact mark-seen packet.

    Key order/values match ``build_mark_seen_payload()`` in GPL-3.0 UnipusAI
    ``src/api/submit.rs``; no invented field can break the completion path.
    ``groupId`` is the resource (task leaf) id and ``courseId`` the course
    instance id, as used by every reviewed upstream implementation.
    """
    return {
        "quesDatas": [],
        "groupId": _identifier(pulse.resource_id),
        "isCompleted": [],
        "thirdPartyJudges": "[]",
        "submitType": 2,
        "hideLoading": True,
        "associationGroupId": "",
        "courseId": _identifier(pulse.course_id),
        "openId": _identifier(pulse.open_id, allow_empty=True),
        "version": "default",
    }


def classify_submit_response(payload: Any) -> FabricatedSendState:
    """Classify ``newExploration/submit`` JSON; never echo raw server text."""
    if not isinstance(payload, dict):
        return FabricatedSendState.PROTOCOL_ERROR
    code = payload.get("code")
    if code == 0 or code == "0":
        return FabricatedSendState.ACCEPTED
    msg = str(payload.get("msg") or payload.get("message") or "")
    if RATE_LIMIT_MESSAGE in msg or code in RATE_LIMIT_CODES or str(code) in {"600001", "600002"}:
        return FabricatedSendState.RATE_LIMITED
    if code in SESSION_CODES or str(code) in {str(c) for c in SESSION_CODES}:
        return FabricatedSendState.SESSION_EXPIRED
    if isinstance(code, (int, str)) and str(code):
        return FabricatedSendState.REJECTED
    return FabricatedSendState.PROTOCOL_ERROR


def classify_progress_leaf(leaf: Any) -> bool | None:
    """Server completion evidence from ``course_progress`` ``rt.leafs``.

    AutoFinish_UxiaoyuanAI requires ``pass==1 and pass2==1 and perm==1``;
    UnipusAI course.rs uses ``pass>=1``. Both are accepted here, with a
    stricter three-flag readback when the flags are present.
    """
    if not isinstance(leaf, dict):
        return None
    state = leaf.get("state")
    if not isinstance(state, dict):
        return None
    passed = state.get("pass")
    try:
        passed_ok = passed is True or float(passed) >= 1
    except (TypeError, ValueError):
        passed_ok = False
    if "pass2" in state or "perm" in state:
        try:
            return bool(passed_ok and float(state.get("pass2", 0)) >= 1
                        and float(state.get("perm", 0)) >= 1)
        except (TypeError, ValueError):
            return False if passed_ok is False else None
    return bool(passed_ok) if passed_ok or passed in (0, "0", False) else None


class FabricatedStateStore:
    """Atomic local-only snapshots for historical inspection, never replay.

    Never stores cookies, tokens, JWTs or annotator secrets; only ids and
    counters. Writes go through a same-directory temp file + os.replace().
    """

    def __init__(self, path: str | os.PathLike[str] | None = None):
        if path is None:
            base = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir())
            path = base / "StudyFlow" / "ucampus_fabricated_state.json"
        self.path = Path(path)
        self._lock = threading.RLock()

    def _read(self) -> dict[str, Any]:
        try:
            raw = self.path.read_text(encoding="utf-8")
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    @staticmethod
    def _safe_snapshot(record: Any) -> dict[str, Any] | None:
        """Persist only local counters; reject credentials, raw errors and metadata.

        This is deliberately a lossy, read-only archive. It cannot be used to
        reconstruct or replay a network learning-event request.
        """
        if not isinstance(record, dict):
            return None
        def safe_id(value: Any) -> str:
            return value if isinstance(value, str) and _ID_RE.fullmatch(value) else ""
        def safe_count(value: Any) -> int:
            return value if type(value) is int and 0 <= value <= 1_000_000 else 0
        phase = record.get("phase")
        if phase not in ("idle", "queued", "running", "paused", "stopping",
                         "finished_locally", "failed", "stopped"):
            phase = "historical"
        raw_tasks = record.get("tasks")
        tasks: dict[str, dict[str, int]] = {}
        if isinstance(raw_tasks, dict):
            for resource_id, row in list(raw_tasks.items())[:200]:
                if (not isinstance(resource_id, str)
                        or not _ID_RE.fullmatch(resource_id)
                        or not isinstance(row, dict)):
                    continue
                tasks[resource_id] = {
                    key: safe_count(row.get(key))
                    for key in ("generated", "sent", "accepted", "confirmed")
                }
        return {
            "course_id": safe_id(record.get("course_id")),
            "unit_id": safe_id(record.get("unit_id")),
            "phase": phase,
            "tasks": tasks,
        }

    def sanitize_existing(self) -> bool:
        """Scrub legacy local archives without starting or resuming any run.

        Returns whether a pre-existing JSON file required sanitization.
        Corrupt/unparseable files are left untouched rather than destroyed.
        """
        with self._lock:
            if not self.path.exists():
                return False
            try:
                raw = self.path.read_text(encoding="utf-8")
                previous = json.loads(raw)
                if not isinstance(previous, dict):
                    return False
            except (OSError, ValueError):
                return False
            clean = {
                key: sanitized
                for key, value in previous.items()
                if isinstance(key, str) and _ID_RE.fullmatch(key)
                for sanitized in (self._safe_snapshot(value),)
                if sanitized is not None
            }
            if previous == clean:
                return False
            fd, tmp = tempfile.mkstemp(prefix=".ucampus-", dir=str(self.path.parent))
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(clean, handle, ensure_ascii=False, separators=(",", ":"))
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(tmp, self.path)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
            return True

    def save(self, run_id: str, record: Mapping[str, Any]) -> None:
        _identifier(run_id)
        if not isinstance(record, dict):
            raise ValueError("UCAMPUS_INVALID_HISTORY_RECORD")
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            # Scrub legacy entries as well when rewriting the archive.
            data = {
                key: sanitized
                for key, value in self._read().items()
                if isinstance(key, str) and _ID_RE.fullmatch(key)
                for sanitized in (self._safe_snapshot(value),)
                if sanitized is not None
            }
            data[run_id] = self._safe_snapshot(record)
            payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            fd, tmp = tempfile.mkstemp(prefix=".ucampus-", dir=str(self.path.parent))
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(tmp, self.path)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise

    def load(self, run_id: str) -> dict[str, Any] | None:
        _identifier(run_id)
        with self._lock:
            record = self._read().get(run_id)
            return self._safe_snapshot(record)

    def list_recent(self, course_id: str, *, limit: int = 5) -> list[dict[str, Any]]:
        """Inspect local snapshots with a fixed safe schema. Never replay events."""
        _identifier(course_id)
        if type(limit) is not int or not 1 <= limit <= 10:
            raise ValueError("UCAMPUS_INVALID_HISTORY_LIMIT")
        def count(value: Any) -> int:
            return value if type(value) is int and 0 <= value <= 1_000_000 else 0
        with self._lock:
            results: list[dict[str, Any]] = []
            for run_id, record in reversed(list(self._read().items())):
                if (not isinstance(run_id, str) or not _ID_RE.fullmatch(run_id)
                        or not isinstance(record, dict)
                        or record.get("course_id") != course_id):
                    continue
                tasks = record.get("tasks")
                if not isinstance(tasks, dict):
                    continue
                rows = [row for row in tasks.values() if isinstance(row, dict)]
                phase = record.get("phase")
                phase = ("interrupted" if phase in ("running", "paused", "stopping")
                         else phase if phase in ("finished_locally", "failed", "stopped")
                         else "historical")
                unit_id = record.get("unit_id")
                results.append({
                    "run_id": run_id, "course_id": course_id,
                    "unit_id": unit_id if isinstance(unit_id, str) and
                        _ID_RE.fullmatch(unit_id) else "",
                    "phase": phase, "resources": len(rows),
                    "generated": sum(count(row.get("generated")) for row in rows),
                    "sent": sum(count(row.get("sent")) for row in rows),
                    "server_readback_passed": sum(count(row.get("confirmed")) for row in rows),
                    "resume_available": False,
                    "progress_causality": "unverified",
                })
                if len(results) >= limit:
                    break
            return results

    def clear(self, run_id: str) -> None:
        _identifier(run_id)
        with self._lock:
            # Removing one entry also scrubs any legacy sensitive fields.
            data = {
                key: sanitized
                for key, value in self._read().items()
                if isinstance(key, str) and _ID_RE.fullmatch(key)
                for sanitized in (self._safe_snapshot(value),)
                if sanitized is not None
            }
            if data.pop(run_id, None) is not None and self.path.exists():
                payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
                fd, tmp = tempfile.mkstemp(prefix=".ucampus-", dir=str(self.path.parent))
                try:
                    with os.fdopen(fd, "w", encoding="utf-8") as handle:
                        handle.write(payload)
                    os.replace(tmp, self.path)
                except BaseException:
                    try:
                        os.unlink(tmp)
                    except OSError:
                        pass
                    raise
