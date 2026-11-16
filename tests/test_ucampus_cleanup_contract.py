"""Regression guards for StudyFlow U校园 dead-code cleanup.

Do not alter active course reading, local simulation, or the distinct
server-state verification boundaries. No network or account is required.
"""
from studyflow.platforms.ucampus.local_runtime import UCampusLocalRunner
from studyflow.platforms.ucampus.fabricated_runner import FabricatedRunner
from studyflow.platforms.ucampus.fabricated_transport import (
    FabricatedTransport, FabricatedReceipt,
)


def test_old_runtime_timestamp_caches_are_not_allocated():
    local = UCampusLocalRunner(interval=0.01)
    experimental = FabricatedRunner()
    assert not hasattr(local, "_started_at")
    assert not hasattr(experimental, "_started_at")
    assert not hasattr(experimental, "_clock")


def test_unused_network_compatibility_wrappers_are_gone():
    assert not hasattr(FabricatedTransport, "send")
    assert not hasattr(FabricatedReceipt, "to_dict")
    # The real coordination interface is still intact.
    assert callable(getattr(FabricatedTransport, "send_result"))
    assert callable(getattr(FabricatedTransport, "confirm"))


def test_both_modes_keep_distinct_idle_status():
    local = UCampusLocalRunner().status("course-v2:123")
    experimental = FabricatedRunner().status("course-v2:123")
    assert local["phase"] == experimental["phase"] == "idle"
    assert local["server_confirmed"] is None
    assert experimental["progress_causality"] == "unverified"
    assert experimental["restart_resume_supported"] is False
