"""U校园 independent learning-activity delivery and platform readback.

This is not an official-player implementation. StudyFlow emits its own local
events; an explicitly configured verified transport is responsible for any
actual network submission. The transport must independently validate that
the activity reflects learning that occurred.

No default sender or fabricated U校园5.0 wire contract is registered.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Protocol

from .course_progress import UCampusProgressError
from .pulse_types import LocalPulse
from .send_transport import SendResult, UCampusSendError


class TaskReader(Protocol):
    def list_tasks(self, course_id: str, unit_id: str) -> list[dict]: ...


class VerifiedTransport(Protocol):
    def send_result(self, pulse: LocalPulse) -> SendResult: ...


class UCampusSubmissionError(RuntimeError):
    """Public error codes only; do not expose private network responses."""


@dataclass(frozen=True)
class DeliveryVerification:
    course_id: str
    unit_id: str
    resource_id: str
    delivery: str
    before: bool | None
    after: bool | None
    server_newly_passed: bool
    server_status_verified: bool
    readback_status: str
    checked_at: str

    def to_dict(self) -> dict:
        return asdict(self)


def _server_completion(reader: TaskReader, pulse: LocalPulse) -> bool | None:
    try:
        rows = reader.list_tasks(pulse.course_id, pulse.chapter_id)
    except UCampusProgressError:
        raise
    except Exception:
        raise UCampusSubmissionError("UCAMPUS_READBACK_UNAVAILABLE") from None
    matching = [row for row in rows if row.get("id") == pulse.resource_id]
    if len(matching) != 1:
        raise UCampusSubmissionError("UCAMPUS_RESOURCE_UNVERIFIED")
    completed = matching[0].get("completed")
    if completed is not True and completed is not False and completed is not None:
        raise UCampusSubmissionError("UCAMPUS_PROGRESS_FORMAT_UNVERIFIED")
    return completed


class UCampusSubmissionCoordinator:
    """One real activity submission with before/after server confirmation.

    Never automatically retries a POST/WebSocket event, especially after an
    unknown delivery outcome. A connection success alone does not set
    server_newly_passed. The local tick clock is never mapped to watched time.
    """
    def __init__(self, reader: TaskReader, transport: VerifiedTransport | None):
        self._reader = reader
        self._transport = transport

    def submit_and_readback(self, pulse: LocalPulse) -> DeliveryVerification:
        if not isinstance(pulse, LocalPulse):
            raise UCampusSubmissionError("UCAMPUS_INVALID_PULSE")
        if (not pulse.course_id or not pulse.chapter_id or not pulse.resource_id
                or type(pulse.sequence) is not int or pulse.sequence < 1):
            raise UCampusSubmissionError("UCAMPUS_INVALID_PULSE")
        baseline = _server_completion(self._reader, pulse)
        if baseline is True:
            return self._result(pulse, "already_passed", baseline, baseline, "verified")
        if baseline is None:
            # Without a known baseline, progress delta cannot be attributed.
            return self._result(pulse, "baseline_unknown", baseline, baseline, "unverified")
        if self._transport is None:
            return self._result(pulse, "not_configured", baseline, None, "not_checked")
        try:
            receipt = self._transport.send_result(pulse)
            if not isinstance(receipt, SendResult):
                raise UCampusSubmissionError("UCAMPUS_SEND_RECEIPT_UNVERIFIED")
        except (UCampusSendError, UCampusSubmissionError):
            # Preserve precise errors for rejected evidence or invalid receipts.
            raise
        except Exception:
            raise UCampusSubmissionError("UCAMPUS_SEND_UNAVAILABLE") from None
        try:
            after = _server_completion(self._reader, pulse)
            return self._result(pulse, receipt.delivery, baseline, after, "verified")
        except (UCampusProgressError, UCampusSubmissionError):
            return self._result(pulse, receipt.delivery, baseline, None, "unavailable")

    @staticmethod
    def _result(pulse: LocalPulse, delivery: str, before: bool | None,
                after: bool | None, readback: str) -> DeliveryVerification:
        return DeliveryVerification(
            course_id=pulse.course_id, unit_id=pulse.chapter_id,
            resource_id=pulse.resource_id, delivery=delivery, before=before,
            after=after, server_newly_passed=(before is False and after is True),
            server_status_verified=(readback == "verified"),
            readback_status=readback,
            checked_at=datetime.now(timezone.utc).isoformat(),
        )
