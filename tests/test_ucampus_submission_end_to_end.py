"""End-to-end orchestration with local fake network and genuine evidence fixture.

Tests do not contact U校园 servers; no production protocol is inferred.
"""
import json

from studyflow.platforms.ucampus.local_runtime import LocalPulse
from studyflow.platforms.ucampus.send_transport import (
    PlaybackEvidence, VerifiedSendContract, UCampusHTTPTransport,
)
from studyflow.platforms.ucampus.submission_coordinator import UCampusSubmissionCoordinator


def test_real_observation_transport_and_server_readback_are_distinct():
    pulse=LocalPulse("run001","course-v2:actual","unit01","video01",3,999.0)
    observed=PlaybackEvidence("course-v2:actual","video01",12.5,90.0,True)
    state={"completed":False}
    payloads=[]
    class Player:
        def get(self,run_id,course_id,resource_id):
            assert (run_id,course_id,resource_id)==(
                "run001","course-v2:actual","video01")
            return observed
    class Reader:
        def list_tasks(self,course_id,unit_id):
            assert course_id=="course-v2:actual" and unit_id=="unit01"
            return [{"id":"video01","completed":state["completed"]}]
    class Response:
        status_code=200
        is_redirect=False
        content=b'{"accepted":true}'
        headers={"content-type":"application/json"}
        def json(self):
            return {"accepted":True}
    def post(url, **kwargs):
        assert url=="https://ucontent.unipus.cn/course/api/v2/activity"
        payloads.append(json.loads(kwargs["data"]))
        state["completed"]=True  # Controlled test fixture ONLY
        return Response()
    contract=VerifiedSendContract(
        "https://ucontent.unipus.cn/course/api/v2/activity",
        payload_encoder=lambda pulse,evidence: {
            "course_id":pulse.course_id,
            "resource_id":pulse.resource_id,
            "observed_seconds":evidence.position_seconds,
        },
        response_verifier=lambda status,data: (
            "accepted" if data.get("accepted") is True else "unknown"
        ))
    sender=UCampusHTTPTransport(contract,Player(),{},post=post)
    result=UCampusSubmissionCoordinator(Reader(),sender).submit_and_readback(pulse)
    assert result.delivery=="accepted"
    assert result.server_newly_passed is True
    assert result.after is True
    assert len(payloads)==1
    assert payloads[0]["observed_seconds"]==12.5
    assert 999.0 not in payloads[0].values()
