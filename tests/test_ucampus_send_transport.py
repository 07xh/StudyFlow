"""No live network calls: verifies strict U校园 activity sender boundaries."""
from __future__ import annotations
import pytest
import requests

from studyflow.platforms.ucampus.pulse_types import LocalPulse
from studyflow.platforms.ucampus.send_transport import (
    PlaybackEvidence, VerifiedSendContract, UCampusHTTPTransport, UCampusSendError,
)


PULSE = LocalPulse("run1", "course-v2:123", "unit1", "resource1", 2, 999.0)
VALID = PlaybackEvidence("course-v2:123", "resource1", 12.0, 100.0, True)


def contract(url="https://ucontent.unipus.cn/course/api/v2/activity"):
    # Fixture protocol is LOCAL TEST-ONLY, never registered in production.
    return VerifiedSendContract(url,
        payload_encoder=lambda pulse, evidence: {
            "course": pulse.course_id, "resource": pulse.resource_id,
            "position": evidence.position_seconds},
        response_verifier=lambda status, data:
            "accepted" if data.get("accepted") is True else
            "rejected" if data.get("accepted") is False else "unknown")


class Source:
    def __init__(self, evidence=VALID):
        self.evidence=evidence
    def get(self, run_id, course_id, resource_id):
        assert run_id == "run1"
        return self.evidence


class Response:
    status_code=200
    is_redirect=False
    content=b'{"accepted":true}'
    headers={"content-type":"application/json"}
    def json(self):
        return {"accepted": True}


def test_sender_uses_observed_position_not_local_clock():
    sent=[]
    def fake_post(url, **kwargs):
        sent.append((url,kwargs))
        return Response()
    sender=UCampusHTTPTransport(contract(), Source(), {"Cookie":"jwt=secret"},
                                post=fake_post)
    result=sender.send_result(PULSE)
    assert result.delivery=="accepted" and result.server_completed is None
    assert len(sent)==1 and sent[0][1]["allow_redirects"] is False
    assert sent[0][1]["timeout"]==(5,12)
    assert b'"position":12.0' in sent[0][1]["data"]
    assert b"999.0" not in sent[0][1]["data"]


def test_no_network_without_actual_playback_evidence():
    called=[]
    def fake_post(*args,**kwargs):
        called.append(1)
        return Response()
    for source in (Source(None),
                   Source(PlaybackEvidence("course-v2:123","resource1",12,100,False)),
                   Source(PlaybackEvidence("other","resource1",12,100,True))):
        sender=UCampusHTTPTransport(contract(),source,{},post=fake_post)
        with pytest.raises(UCampusSendError,match="UCAMPUS_ACTIVITY_NOT_VERIFIED"):
            sender.send(PULSE)
    assert called==[]


def test_rejects_unknown_host_and_unverified_paths():
    for url in ("http://ucontent.unipus.cn/course/api/v2/activity",
                "https://example.org/course/api/v2/activity",
                "https://ucontent.unipus.cn.evil.tld/course/api/v2/activity",
                "https://ucontent.unipus.cn/other/api",
                "https://ucontent.unipus.cn/course/api/v2/../other",
                "https://ucontent.unipus.cn/course/api/v2/activity?next=evil"):
        with pytest.raises(ValueError,match="UCAMPUS_UNVERIFIED_SEND_URL"):
            contract(url)


def test_unknown_ack_is_not_treated_as_success():
    class UnknownResponse(Response):
        def json(self):
            return {"code":1}
    sender=UCampusHTTPTransport(contract(), Source(), {},post=lambda *a,**k: UnknownResponse())
    assert sender.send_result(PULSE).delivery=="unknown"
    assert sender.send(PULSE) is False


def test_timeout_not_automatically_retried():
    calls=[]
    def fake_post(*args,**kwargs):
        calls.append(True)
        raise requests.Timeout("network is unavailable")
    sender=UCampusHTTPTransport(contract(),Source(),{},post=fake_post)
    result=sender.send_result(PULSE)
    assert len(calls)==1 and result.delivery=="unknown" and result.http_status is None


def test_unauthorized_http_response_is_not_logged_or_claimed():
    class Expired(Response):
        status_code=401
    sender=UCampusHTTPTransport(contract(),Source(),{},post=lambda *a,**k: Expired())
    with pytest.raises(UCampusSendError,match="UCAMPUS_SESSION_EXPIRED"):
        sender.send(PULSE)


def test_invalid_evidence_and_header_values():
    with pytest.raises(ValueError):
        PlaybackEvidence("c","r",101.0,100.0,True)
    with pytest.raises(ValueError):
        PlaybackEvidence("c","r",float("nan"),100.0,True)
    with pytest.raises(ValueError):
        UCampusHTTPTransport(contract(),Source(),{"Cookie":"secret\nnewheader"})
    with pytest.raises(ValueError):
        UCampusHTTPTransport(contract(),Source(),{"Host":"example.org"})


def test_success_code_must_be_verified_not_assumed():
    # Platform-independent 200 OK is not an ack. It is up to a real,
    # account-verified protocol to supply a response_verifier.
    class NoAck(Response):
        content=b'{}'
        def json(self):
            return {}
    sender=UCampusHTTPTransport(contract(),Source(),{},post=lambda *a,**k:NoAck())
    assert sender.send_result(PULSE).delivery=="unknown"
