"""Dual-channel sender for StudyFlow's fabricated U校园 heartbeats.

Channel 1 (intermediate pulses): legacy Socket.IO ``start`` activity frames,
emitted from a local invented position -- the "watch time" heartbeats.
Reuses StudyFlow's own ``socketio_client.UCampusLegacySocket`` (an independent
Engine.IO v3 implementation) with the event shape documented by the archived
``z5882852/unipus-tool/ws.py``. A socket reply is never treated as credit.

Channel 2 (final pulse): ``POST /course/api/v3/newExploration/submit`` with
``submitType=2`` (mark seen). This is the decisive completion declaration,
verified by GPL-3.0 UnipusAI, Apache-2.0 AutoFinish_UxiaoyuanAI and MIT
UnipusHelper.NET. Rate-limit responses use the upstream escalating cooldown.

Channel 3 (optional): read-only ``course_progress`` readback confirms
``rt.leafs[id].state.pass`` (and ``pass2``/``perm`` when present).

All network calls are injectable so the entire sender is offline-testable.
No credential value is ever placed in a log, error string or state record.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Protocol
from urllib.parse import quote

from . import fabricated_heartbeat as fh


class HeartbeatSocket(Protocol):
    def emit(self, event_name: str, event_data: dict[str, Any]) -> str: ...
    def close(self) -> Any: ...


class ProgressReader(Protocol):
    def list_tasks(self, course_id: str, unit_id: str) -> list[dict]:
        """Read-only platform progress; ``completed`` is server evidence."""


@dataclass(frozen=True)
class FabricatedReceipt:
    state: str
    delivery: str
    accepted: bool
    server_confirmed: bool | None
    attempts: int
    position_seconds: float
    completion: bool
    socket_reply: str


def _valid_path_id(value: Any) -> str:
    if not isinstance(value, str) or not fh._ID_RE.fullmatch(value):
        raise ValueError("UCAMPUS_INVALID_FABRICATED_PAYLOAD")
    return value


def session_headers(credentials_loader: Callable[[], Any] | None = None) -> tuple[dict[str, str], str]:
    """Reuse ``course_progress._headers`` instead of duplicating auth logic.

    Returns ``(headers, open_id)``. ``Content-Type`` is added for the POST.
    """
    from . import course_progress, credentials as credentials_module

    loader = credentials_loader or credentials_module.load
    config = loader()
    if config is None:
        raise RuntimeError("UCAMPUS_SESSION_MISSING")
    if config.variant != "ai":
        raise RuntimeError("UCAMPUS_AI_ONLY")
    open_id = course_progress._jwt_open_id(config)
    headers = dict(course_progress._headers(config, open_id))
    headers["Content-Type"] = "application/json; charset=UTF-8"
    return headers, open_id


def progress_url(course_id: str, unit_id: str, open_id: str) -> str:
    course = quote(_valid_path_id(course_id), safe=":")
    unit = quote(_valid_path_id(unit_id), safe=":")
    oid = quote(_valid_path_id(open_id), safe="")
    return (f"{fh.CONTENT_ORIGIN}/course/api/v2/course_progress/"
            f"{course}/{unit}/{oid}/default/")


def _default_post(url: str, payload: dict[str, Any],
                  headers: Mapping[str, str]) -> dict[str, Any]:
    import requests
    response = requests.post(url, data=json.dumps(payload, separators=(",", ":")),
                             headers=dict(headers), timeout=(5, 15),
                             allow_redirects=False)
    if response.status_code in (401, 403):
        return {"code": 401}
    if response.status_code != 200 or response.is_redirect:
        return {"code": -1}
    if len(response.content) > 2_000_000:
        return {"code": -1}
    body = response.json()
    return body if isinstance(body, dict) else {"code": -1}


def _default_get(url: str, headers: Mapping[str, str]) -> dict[str, Any]:
    import requests
    response = requests.get(url, headers=dict(headers), timeout=(5, 12),
                            allow_redirects=False)
    if response.status_code != 200 or response.is_redirect:
        raise RuntimeError("UCAMPUS_PROGRESS_UNAVAILABLE")
    body = response.json()
    return body if isinstance(body, dict) else {}


def _default_socket_factory(open_id: str, token: str) -> HeartbeatSocket:
    from .socketio_client import SocketSession, UCampusLegacySocket
    socket = UCampusLegacySocket(SocketSession(open_id, token))
    socket.connect()
    return socket


class FabricatedTransport:
    """Sends invented activity heartbeats and the upstream mark-seen packet."""

    def __init__(self, *, reader: ProgressReader | None = None,
                 credentials_loader: Callable[[], Any] | None = None,
                 post: Callable[[str, dict, Mapping[str, str]], dict] | None = None,
                 get: Callable[[str, Mapping[str, str]], dict] | None = None,
                 socket_factory: Callable[[str, str], HeartbeatSocket] | None = None,
                 sleep: Callable[[float], Any] | None = None,
                 cooldown_seconds: float = fh.DEFAULT_COOLDOWN_SECONDS,
                 max_retries: int = fh.MAX_RATE_LIMIT_RETRIES,
                 readback: bool = True,
                 headers: Mapping[str, str] | None = None,
                 open_id: str = ""):
        if (not isinstance(cooldown_seconds, (int, float)) or cooldown_seconds <= 0
                or type(max_retries) is not int or not 0 <= max_retries <= 10):
            raise ValueError("UCAMPUS_INVALID_FABRICATED_PARAMETER")
        self._reader = reader
        self._credentials_loader = credentials_loader
        self._post = post or _default_post
        self._get = get or _default_get
        self._socket_factory = socket_factory or _default_socket_factory
        self._sleep = sleep or time.sleep
        self._cooldown = float(cooldown_seconds)
        self._max_retries = max_retries
        self._readback = bool(readback)
        self._socket: HeartbeatSocket | None = None
        self._headers: dict[str, str] = dict(headers or {})
        self._open_id: str = open_id
        self._last_error = ""

    @property
    def connected(self) -> bool:
        return self._socket is not None

    @property
    def last_error(self) -> str:
        return self._last_error

    def open(self, credentials_loader: Callable[[], Any] | None = None) -> bool:
        """Prepare auth headers and open one long-lived activity socket."""
        loader = credentials_loader or self._credentials_loader
        self._headers, self._open_id = session_headers(loader)
        config = (loader or self._default_loader)()
        token = getattr(config, "annotator_token", "") if config is not None else ""
        if not token:
            # The Socket.IO channel is optional; completion still works over HTTP.
            self._close_socket()
            return False
        try:
            self._socket = self._socket_factory(self._open_id, token)
            return True
        except Exception:
            self._close_socket()
            return False

    @staticmethod
    def _default_loader() -> Any:
        from . import credentials
        return credentials.load()

    def _close_socket(self) -> None:
        socket, self._socket = self._socket, None
        if socket is not None:
            try:
                socket.close()
            except Exception:
                pass

    def close(self) -> None:
        self._close_socket()

    def _ensure_headers(self) -> None:
        if not self._headers:
            self._headers, self._open_id = session_headers(self._credentials_loader)

    def emit_activity(self, pulse: Any,
                      target: fh.FabricatedTarget | None = None) -> tuple[str, str]:
        """Channel 1: one invented playback-position heartbeat."""
        data = fh.build_activity_event(pulse, target)
        if self._socket is None:
            return fh.FabricatedSendState.SOCKET_UNVERIFIED.value, "no_socket"
        try:
            reply = self._socket.emit("start", data)
        except Exception:
            self._close_socket()
            return fh.FabricatedSendState.SOCKET_UNVERIFIED.value, "socket_error"
        # ws.py's server replies are not correlated acks and never prove credit.
        return fh.FabricatedSendState.SENT.value, str(reply)[:64]

    def submit_completion(self, pulse: Any) -> tuple[str, int, bool]:
        """Channel 2: mark-seen POST with upstream rate-limit cooldown."""
        self._ensure_headers()
        payload = fh.build_mark_seen_payload(pulse)
        if self._open_id and not payload["openId"]:
            payload["openId"] = self._open_id
        attempts = 0
        state = fh.FabricatedSendState.PROTOCOL_ERROR
        while True:
            attempts += 1
            try:
                body = self._post(fh.MARK_SEEN_URL, payload, self._headers)
                state = fh.classify_submit_response(body)
            except Exception:
                state = fh.FabricatedSendState.NETWORK_ERROR
            if state is not fh.FabricatedSendState.RATE_LIMITED or attempts > self._max_retries:
                break
            self._sleep(self._cooldown * attempts)
        accepted = state is fh.FabricatedSendState.ACCEPTED
        if state is fh.FabricatedSendState.NETWORK_ERROR:
            self._last_error = "UCAMPUS_SEND_UNAVAILABLE"
        elif state is fh.FabricatedSendState.SESSION_EXPIRED:
            self._last_error = "UCAMPUS_SESSION_EXPIRED"
        elif state is fh.FabricatedSendState.RATE_LIMITED:
            self._last_error = "UCAMPUS_RATE_LIMITED"
        elif state is fh.FabricatedSendState.REJECTED:
            self._last_error = "UCAMPUS_SUBMIT_REJECTED"
        elif not accepted:
            self._last_error = "UCAMPUS_SUBMIT_UNVERIFIED"
        else:
            self._last_error = ""
        return state.value, attempts, accepted

    def confirm(self, pulse: Any) -> bool | None:
        """Channel 3: read-only server progress readback."""
        if not self._readback and self._reader is None:
            return None
        self._ensure_headers()
        if self._reader is not None:
            try:
                rows = self._reader.list_tasks(pulse.course_id, pulse.unit_id)
            except Exception:
                return None
            matching = [row for row in rows if row.get("id") == pulse.resource_id]
            if len(matching) != 1:
                return None
            completed = matching[0].get("completed")
            return completed if isinstance(completed, bool) else None
        try:
            body = self._get(
                progress_url(pulse.course_id, pulse.unit_id, self._open_id),
                self._headers)
        except Exception:
            return None
        rt = body.get("rt") if isinstance(body, dict) else None
        leaves = rt.get("leafs") if isinstance(rt, dict) else None
        leaf = leaves.get(pulse.resource_id) if isinstance(leaves, dict) else None
        return fh.classify_progress_leaf(leaf)

    def send_result(self, pulse: Any,
                    target: fh.FabricatedTarget | None = None) -> FabricatedReceipt:
        """One pulse: intermediate socket heartbeat, or final completion POST."""
        if not getattr(pulse, "completion", False):
            state, reply = self.emit_activity(pulse, target)
            return FabricatedReceipt(
                state=state, delivery="socket_activity", accepted=False,
                server_confirmed=None, attempts=1,
                position_seconds=float(pulse.position_seconds),
                completion=False, socket_reply=reply)
        state, attempts, accepted = self.submit_completion(pulse)
        confirmed = self.confirm(pulse) if accepted else None
        if confirmed is True:
            state = fh.FabricatedSendState.CONFIRMED.value
        return FabricatedReceipt(
            state=state, delivery="mark_seen_submit", accepted=accepted,
            server_confirmed=confirmed, attempts=attempts,
            position_seconds=float(pulse.position_seconds),
            completion=True, socket_reply="")

