"""Isolated, TLS-verified Engine.IO 3 / Socket.IO transport for U校园.

The archived z5882852/unipus-tool ws.py documents an older Socket.IO-style
transport. This is an original implementation of connection management, not a
copy of that unlicensed source file. The actual AI 5.0 learning-event protocol
and server credit rules have not been verified.

Local heartbeat generation in local_runtime.py is independent of this module.
No production learning event is automatically registered or sent by this code.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any, Callable, Protocol
from urllib.parse import urlencode, urlsplit

_ENDPOINT = "wss://ucontent.unipus.cn/unipusio/"
_NAMESPACE = "/userActivities"
_MAX_FRAME = 65536


class SocketProtocolError(RuntimeError):
    """Code-only errors, never contain connection credentials or server frames."""


class SocketConnection(Protocol):
    def send(self, text: str) -> Any: ...
    def recv(self) -> str: ...
    def close(self) -> Any: ...


@dataclass(frozen=True)
class SocketSession:
    open_id: str = field(repr=False)
    annotator_token: str = field(repr=False)

    def __post_init__(self) -> None:
        if (not isinstance(self.open_id, str) or not 1 <= len(self.open_id) <= 256
                or not isinstance(self.annotator_token, str)
                or not 1 <= len(self.annotator_token) <= 4096
                or any(ord(ch) < 33 or ord(ch) == 127 for ch in self.open_id)
                or any(ord(ch) < 33 or ord(ch) == 127 for ch in self.annotator_token)):
            raise ValueError("UCAMPUS_SOCKET_SESSION_INVALID")


def make_legacy_url(session: SocketSession) -> str:
    """Construct the archived transport route; no URL comes from a server."""
    params = urlencode({"uuid": session.open_id, "token": session.annotator_token,
                        "EIO": "3", "transport": "websocket"})
    return _ENDPOINT + "?" + params


def _default_connect(url: str) -> SocketConnection:
    """Uses websocket-client's default CA verification; never disables TLS."""
    import websocket
    return websocket.create_connection(url, timeout=8, enable_multithread=True)


class UCampusLegacySocket:
    """Connection, namespaces, bounded reads and Engine.IO ping/pong.

    Experimental wire transport only. A caller must explicitly supply an event
    contract established for its own account/version; this class does not invent
    any video/audio learning packet or infer platform study progress.
    """
    def __init__(self, session: SocketSession, *,
                 connect: Callable[[str], SocketConnection] | None = None) -> None:
        self._session = session
        self._connect = connect or _default_connect
        self._socket: SocketConnection | None = None
        self._connected = False

    def _recv(self) -> str:
        ws = self._socket
        if ws is None:
            raise SocketProtocolError("UCAMPUS_SOCKET_NOT_CONNECTED")
        # Socket.IO Engine.IO heartbeat frame: a ping ("2") requires pong ("3").
        for _ in range(12):
            try:
                frame = ws.recv()
            except Exception:
                raise SocketProtocolError("UCAMPUS_SOCKET_TRANSPORT_UNKNOWN") from None
            if not isinstance(frame, str) or len(frame) > _MAX_FRAME:
                raise SocketProtocolError("UCAMPUS_SOCKET_BAD_FRAME")
            if frame == "2":
                try:
                    ws.send("3")
                except Exception:
                    raise SocketProtocolError("UCAMPUS_SOCKET_TRANSPORT_UNKNOWN") from None
                continue
            return frame
        raise SocketProtocolError("UCAMPUS_SOCKET_NO_ACK")

    def connect(self) -> None:
        if self._socket is not None:
            raise SocketProtocolError("UCAMPUS_SOCKET_ALREADY_OPEN")
        url = make_legacy_url(self._session)
        parsed = urlsplit(url)
        if parsed.scheme != "wss" or parsed.hostname != "ucontent.unipus.cn":
            raise SocketProtocolError("UCAMPUS_SOCKET_URL_REJECTED")
        try:
            self._socket = self._connect(url)
            opening = self._recv()
            if not opening.startswith("0{"):
                raise SocketProtocolError("UCAMPUS_SOCKET_HANDSHAKE_UNVERIFIED")
            packet = json.loads(opening[1:])
            if not isinstance(packet, dict) or not isinstance(packet.get("sid"), str):
                raise SocketProtocolError("UCAMPUS_SOCKET_HANDSHAKE_UNVERIFIED")
            # Legacy namespace connection; never echo credential-bearing frames.
            credentials = urlencode({"uuid": self._session.open_id,
                                     "token": self._session.annotator_token})
            self._socket.send("40" + _NAMESPACE + "?" + credentials + ",")
            ack = self._recv()
            if not (ack == "40" + _NAMESPACE or ack.startswith("40" + _NAMESPACE + ",")):
                raise SocketProtocolError("UCAMPUS_SOCKET_NAMESPACE_UNVERIFIED")
            self._connected = True
        except SocketProtocolError:
            self.close()
            raise
        except (TypeError, ValueError, Exception):
            self.close()
            raise SocketProtocolError("UCAMPUS_SOCKET_TRANSPORT_UNKNOWN") from None

    def emit(self, event_name: str, event_data: dict[str, Any]) -> str:
        """Low-level event send; reply is not evidence of server completion.

        This is not invoked by the StudyFlow heartbeat runner in production.
        """
        if not self._connected or self._socket is None:
            raise SocketProtocolError("UCAMPUS_SOCKET_NOT_CONNECTED")
        if (not isinstance(event_name, str) or not 1 <= len(event_name) <= 40
                or not event_name.replace("_", "").replace("-", "").isalnum()
                or not isinstance(event_data, dict) or len(event_data) > 30):
            raise ValueError("UCAMPUS_SOCKET_INVALID_EVENT")
        try:
            body = json.dumps([event_name, event_data], ensure_ascii=False,
                              allow_nan=False, separators=(",", ":"))
            if len(body.encode("utf-8")) > 16384:
                raise ValueError
        except (TypeError, ValueError):
            raise ValueError("UCAMPUS_SOCKET_INVALID_EVENT") from None
        frame = "42" + _NAMESPACE + "," + body
        try:
            self._socket.send(frame)
            response = self._recv()
        except SocketProtocolError:
            raise
        except Exception:
            raise SocketProtocolError("UCAMPUS_SOCKET_TRANSPORT_UNKNOWN") from None
        # Return a coarse frame classification only. No raw server payload
        # or secrets enter logs and no reply is treated as study credit.
        if response.startswith("42" + _NAMESPACE + ","):
            return "event"
        if response.startswith("43" + _NAMESPACE + ","):
            return "ack_unverified"
        return "unknown"

    def close(self) -> None:
        self._connected = False
        ws = self._socket
        self._socket = None
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass

    def __enter__(self) -> "UCampusLegacySocket":
        self.connect()
        return self

    def __exit__(self, _type, _value, _tb) -> None:
        self.close()
