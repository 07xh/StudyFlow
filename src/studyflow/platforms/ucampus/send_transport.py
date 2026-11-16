"""Fail-closed U校园 activity HTTP transport (contract awaiting account verification).

Locally generated scheduler ticks are not proof of watched media, nor a
server-side course completion. This module supplies a real HTTP/JSON transport
boundary with response classification. A caller must provide separately
observed learning activity and an approved protocol contract. There is NO
default endpoint or automatically registered production uploader.

Do not use the unrelated UnipusAI "mark seen"/answer submission endpoint as
a video heartbeat endpoint. That upstream code does not establish one.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Any, Callable, Mapping, Protocol
from urllib.parse import urlsplit

import requests

from .local_runtime import LocalPulse

_ALLOWED_HOSTS = frozenset(("ucontent.unipus.cn",))
_PATH_RE = re.compile(r"^/course/api/v2/[A-Za-z0-9_:/.-]{1,256}$")
_ID_RE = re.compile(r"^[A-Za-z0-9_:-]{1,128}$")
_ACCEPTED = "accepted"
_REJECTED = "rejected"
_UNKNOWN = "unknown"


class UCampusSendError(RuntimeError):
    """Public error code only; never includes server body, URL, or credentials."""


@dataclass(frozen=True)
class PlaybackEvidence:
    """Actual local-player observation; not the heartbeat scheduler's wall clock."""
    course_id: str
    resource_id: str
    position_seconds: float
    duration_seconds: float
    actively_playing: bool

    def __post_init__(self) -> None:
        if (not isinstance(self.course_id, str) or not _ID_RE.fullmatch(self.course_id)
                or not isinstance(self.resource_id, str) or not _ID_RE.fullmatch(self.resource_id)
                or not isinstance(self.position_seconds, (int, float))
                or not isinstance(self.duration_seconds, (int, float))
                or not math.isfinite(self.position_seconds)
                or not math.isfinite(self.duration_seconds)
                or not 0 <= self.position_seconds <= self.duration_seconds <= 3600000
                or type(self.actively_playing) is not bool):
            raise ValueError("UCAMPUS_INVALID_ACTIVITY_EVIDENCE")


class EvidenceProvider(Protocol):
    def get(self, run_id: str, course_id: str, resource_id: str) -> PlaybackEvidence | None: ...


@dataclass(frozen=True)
class SendResult:
    delivery: str
    http_status: int | None
    server_completed: None = None

    def __post_init__(self) -> None:
        if self.delivery not in (_ACCEPTED, _REJECTED, _UNKNOWN):
            raise ValueError("UCAMPUS_INVALID_DELIVERY")


@dataclass(frozen=True)
class VerifiedSendContract:
    """Code-reviewed contract from a real, owner-authorized request sample.

    Not constructible from arbitrary UI parameters. 'response_verifier'
    must return a three-state delivery verdict from the actual U校园 response.
    Only an explicitly registered and account-verified protocol should be
    passed to this class at runtime.
    """
    url: str
    payload_encoder: Callable[[LocalPulse, PlaybackEvidence], Mapping[str, Any]]
    response_verifier: Callable[[int, Mapping[str, Any]], str]

    def __post_init__(self) -> None:
        try:
            u = urlsplit(self.url)
        except ValueError as exc:
            raise ValueError("UCAMPUS_UNVERIFIED_SEND_URL") from exc
        if (u.scheme != "https" or u.hostname not in _ALLOWED_HOSTS
                or u.username is not None or u.password is not None or u.port is not None
                or u.query or u.fragment or not _PATH_RE.fullmatch(u.path)
                or ".." in u.path or "%" in u.path):
            raise ValueError("UCAMPUS_UNVERIFIED_SEND_URL")
        if not callable(self.payload_encoder) or not callable(self.response_verifier):
            raise ValueError("UCAMPUS_INVALID_SEND_CONTRACT")


class UCampusHTTPTransport:
    """Send an observed activity using an externally verified protocol.

    There is deliberately no built-in VerifiedSendContract. In particular,
    LocalPulse.local_elapsed_seconds is NOT used as watch position.
    """
    def __init__(self, contract: VerifiedSendContract, evidence: EvidenceProvider,
                 credential_headers: Mapping[str, str], *,
                 post: Callable[..., Any] | None = None) -> None:
        self._contract = contract
        self._evidence = evidence
        self._post = post or requests.post
        # Whitelist credentials to the exact approved U校园 first-party host.
        allowed = frozenset(("Cookie", "Authorization", "x-annotator-auth-token",
                             "u-openid", "x-csrftoken", "u-app-id", "u-platform",
                             "u-school"))
        if (not isinstance(credential_headers, Mapping)
                or any(k not in allowed or not isinstance(v, str)
                       or len(v) > 8192 or "\r" in v or "\n" in v
                       for k, v in credential_headers.items())):
            raise ValueError("UCAMPUS_INVALID_SEND_HEADERS")
        self._headers = {"Accept": "application/json",
                         "Content-Type": "application/json", **credential_headers}

    def send_result(self, pulse: LocalPulse) -> SendResult:
        if not isinstance(pulse, LocalPulse):
            raise ValueError("UCAMPUS_INVALID_PULSE")
        try:
            activity = self._evidence.get(pulse.run_id, pulse.course_id, pulse.resource_id)
        except Exception as exc:
            raise UCampusSendError("UCAMPUS_ACTIVITY_NOT_VERIFIED") from None
        if (activity is None or not isinstance(activity, PlaybackEvidence)
                or not activity.actively_playing
                or activity.course_id != pulse.course_id
                or activity.resource_id != pulse.resource_id):
            raise UCampusSendError("UCAMPUS_ACTIVITY_NOT_VERIFIED")
        try:
            payload = self._contract.payload_encoder(pulse, activity)
            if not isinstance(payload, Mapping) or len(payload) > 40:
                raise ValueError
            # Require finite, serializable values without trusting the encoder.
            import json
            encoded = json.dumps(dict(payload), allow_nan=False, separators=(",", ":"))
            if len(encoded.encode("utf-8")) > 16_384:
                raise ValueError
        except (ValueError, TypeError, OverflowError) as exc:
            raise UCampusSendError("UCAMPUS_INVALID_SEND_PAYLOAD") from None
        try:
            response = self._post(
                self._contract.url, data=encoded.encode("utf-8"),
                headers=self._headers, timeout=(5, 12), allow_redirects=False)
        except requests.RequestException:
            # POST timeout/connection loss may have happened after server
            # receipt. Never retry automatically: the result is unknown.
            return SendResult(_UNKNOWN, None)
        status = response.status_code
        if status in (401, 403):
            raise UCampusSendError("UCAMPUS_SESSION_EXPIRED")
        if (status < 200 or status >= 300 or response.is_redirect
                or len(response.content) > 65_536
                or "json" not in response.headers.get("content-type", "").lower()):
            return SendResult(_REJECTED if 400 <= status < 500 else _UNKNOWN, status)
        try:
            data = response.json()
            if not isinstance(data, dict):
                return SendResult(_UNKNOWN, status)
            verdict = self._contract.response_verifier(status, data)
            if verdict not in (_ACCEPTED, _REJECTED, _UNKNOWN):
                return SendResult(_UNKNOWN, status)
            return SendResult(verdict, status)
        except (ValueError, TypeError):
            return SendResult(_UNKNOWN, status)

    def send(self, pulse: LocalPulse) -> bool:
        """True only when a verified contract explicitly acknowledged delivery.

        Acknowledgement is NEVER completion or grading evidence.
        """
        return self.send_result(pulse).delivery == _ACCEPTED
