"""Offline integration contracts for actual submission plus server readback."""
import pytest

from studyflow.platforms.ucampus.local_runtime import LocalPulse
from studyflow.platforms.ucampus.send_transport import SendResult
from studyflow.platforms.ucampus.submission_coordinator import (
    UCampusSubmissionCoordinator, UCampusSubmissionError,
)

PULSE = LocalPulse("run123", "course-v2:123", "unit1", "resource1", 1, 999.0)


class Reader:
    def __init__(self, states):
        self.states=list(states)
        self.calls=[]
    def list_tasks(self, course_id, unit_id):
        self.calls.append((course_id, unit_id))
        state=self.states.pop(0) if len(self.states)>1 else self.states[0]
        return [{"id":"resource1","type":"video","completed":state}]


class Sender:
    def __init__(self, delivery="accepted"):
        self.delivery=delivery
        self.sent=[]
    def send_result(self, pulse):
        self.sent.append(pulse)
        return SendResult(self.delivery,200)


def test_verified_server_transition_is_separate_from_transport_delivery():
    reader=Reader([False,True])
    sender=Sender("accepted")
    result=UCampusSubmissionCoordinator(reader,sender).submit_and_readback(PULSE)
    assert result.delivery=="accepted"
    assert result.before is False and result.after is True
    assert result.server_newly_passed is True
    assert result.server_status_verified is True
    assert result.to_dict()["resource_id"]=="resource1"
    assert len(reader.calls)==2 and sender.sent==[PULSE]


def test_delivery_ack_alone_never_counts_as_server_progress():
    reader=Reader([False,False])
    sender=Sender("accepted")
    result=UCampusSubmissionCoordinator(reader,sender).submit_and_readback(PULSE)
    assert result.delivery=="accepted" and result.server_newly_passed is False
    assert result.after is False


def test_uncertain_network_delivery_does_not_trigger_automatic_retry():
    sender=Sender("unknown")
    result=UCampusSubmissionCoordinator(Reader([False,False]),sender).submit_and_readback(PULSE)
    assert result.delivery=="unknown" and len(sender.sent)==1
    assert result.server_newly_passed is False


def test_no_submission_when_already_passed_or_unknown_baseline():
    for baseline, expected in ((True,"already_passed"),(None,"baseline_unknown")):
        sender=Sender()
        result=UCampusSubmissionCoordinator(Reader([baseline]),sender).submit_and_readback(PULSE)
        assert result.delivery==expected and not sender.sent


def test_no_configured_sender_does_not_write_remote_progress():
    reader=Reader([False])
    result=UCampusSubmissionCoordinator(reader,None).submit_and_readback(PULSE)
    assert result.delivery=="not_configured" and result.readback_status=="not_checked"
    assert len(reader.calls)==1 and result.server_newly_passed is False


def test_readback_error_has_unknown_result_not_false_success():
    class BrokenReader(Reader):
        def list_tasks(self, course_id, unit_id):
            if self.calls:
                raise RuntimeError("local readback outage")
            return super().list_tasks(course_id,unit_id)
    result=UCampusSubmissionCoordinator(BrokenReader([False]),Sender()).submit_and_readback(PULSE)
    assert result.readback_status=="unavailable" and result.after is None
    assert result.server_newly_passed is False


def test_unknown_resource_is_never_submitted():
    class MissingReader:
        def list_tasks(self, course_id, unit_id): return []
    sender=Sender()
    with pytest.raises(UCampusSubmissionError,match="UCAMPUS_RESOURCE_UNVERIFIED"):
        UCampusSubmissionCoordinator(MissingReader(),sender).submit_and_readback(PULSE)
    assert sender.sent==[]


def test_send_result_is_not_allowed_to_invent_an_ack():
    class BrokenSender:
        def send_result(self, pulse):
            return {"ok":True}
    with pytest.raises(UCampusSubmissionError,match="UCAMPUS_SEND_RECEIPT_UNVERIFIED"):
        UCampusSubmissionCoordinator(Reader([False]),BrokenSender()).submit_and_readback(PULSE)
