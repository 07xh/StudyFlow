"""U校园 retired local-runner and independent experimental protocol boundaries."""
from pathlib import Path

from studyflow.platforms.ucampus.fabricated_runner import FabricatedRunner
from studyflow.platforms.ucampus.fabricated_transport import FabricatedTransport, FabricatedReceipt
from studyflow.services.bridge import dispatch


def test_old_local_runtime_and_ipc_are_retired():
    root = Path(__file__).resolve().parents[1]
    assert not (root / "src/studyflow/platforms/ucampus/local_runtime.py").exists()
    assert not (root / "src/studyflow/services/ucampus_runtime_bridge.py").exists()
    result = dispatch({"id": "legacy", "version": 1, "operation": "ucampus.heartbeat.status",
                       "course_id": "course-v2:123"})
    assert result == {"id": "legacy", "ok": False, "error": "UNKNOWN_OPERATION"}


def test_experimental_network_contract_remains_independent():
    runner = FabricatedRunner()
    assert not hasattr(runner, "_started_at")
    assert not hasattr(runner, "_clock")
    status = runner.status("course-v2:123")
    assert status["phase"] == "idle"
    assert status["progress_causality"] == "unverified"
    assert status["restart_resume_supported"] is False


def test_unused_network_wrappers_stay_removed():
    assert not hasattr(FabricatedTransport, "send")
    assert not hasattr(FabricatedReceipt, "to_dict")
    assert callable(getattr(FabricatedTransport, "send_result"))
    assert callable(getattr(FabricatedTransport, "confirm"))
