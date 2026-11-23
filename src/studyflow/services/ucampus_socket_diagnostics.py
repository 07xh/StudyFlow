"""Read-only connection diagnostic for legacy U校园 Socket.IO.

Does not generate or send learning events, or claim AI 5.0 compatibility.
"""
from __future__ import annotations

from typing import Any
from studyflow.platforms.ucampus import credentials as ucampus_credentials
from studyflow.platforms.ucampus.course_progress import UCampusProgressError, _jwt_open_id
from studyflow.platforms.ucampus.socketio_client import SocketSession, SocketProtocolError, UCampusLegacySocket


def diagnose_legacy_socket() -> dict[str, Any]:
    """Opt-in, authentication-only legacy WSS handshake.

    No study events are sent, and a successful namespace connection is not
    evidence that U校园AI5.0 accepts the older learning-event wire format.
    """
    config = ucampus_credentials.load()
    if config is None:
        return {"ok": False, "error": "UCAMPUS_SESSION_MISSING"}
    if config.variant != "ai":
        return {"ok": False, "error": "UCAMPUS_AI_ONLY"}
    if not config.annotator_token:
        return {"ok": False, "error": "UCAMPUS_SOCKET_TOKEN_REQUIRED"}
    try:
        open_id = _jwt_open_id(config)
        session = SocketSession(open_id, config.annotator_token)
        with UCampusLegacySocket(session):
            return {"ok": True, "transport": "legacy_socketio_v3",
                    "handshake": "namespace_joined", "learning_events_sent": 0,
                    "progress_verified": False, "ai5_compatible": None}
    except UCampusProgressError as exc:
        return {"ok": False, "error": str(exc)}
    except SocketProtocolError as exc:
        return {"ok": False, "error": str(exc)}
    except ValueError:
        return {"ok": False, "error": "UCAMPUS_SOCKET_SESSION_INVALID"}
    except Exception:
        return {"ok": False, "error": "UCAMPUS_SOCKET_TRANSPORT_UNKNOWN"}

