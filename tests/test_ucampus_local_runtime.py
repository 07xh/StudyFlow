"""Only observed media and reviewed transports can advance a local U校园 run."""
import time
import pytest

from studyflow.platforms.ucampus.local_runtime import (
    MediaTask, MediaPosition, UCampusLocalRunner,
)


def task(chapter="U1", resource="R1"):
    return MediaTask("course1", chapter, resource, "章节资源")


def wait_finished(runner):
    for _ in range(100):
        result = runner.status("course1")
        if result["phase"] == "ended_locally":
            return result
        time.sleep(0.01)
    raise AssertionError("runner did not finish")


def test_fails_closed_without_real_observer_or_sender():
    runner = UCampusLocalRunner()
    with pytest.raises(RuntimeError, match="UCAMPUS_HEARTBEAT_PROTOCOL_UNVERIFIED"):
        runner.start("course1", [task()], observer=None, transport=None)
    assert runner.status("course1")["sent"] == 0


def test_sender_only_receives_observed_positions_and_no_completion_claims():
    class Observer:
        def __init__(self):
            self.n = 0
        def observe(self, _target):
            self.n += 1
            return MediaPosition(float(self.n), playing=True, ended=self.n >= 2)
    class Sender:
        def __init__(self):
            self.pulses = []
        def send(self, pulse):
            self.pulses.append(pulse)
            return True

    sender = Sender()
    runner = UCampusLocalRunner(interval=0.01)
    runner.start("course1", [task()], observer=Observer(), transport=sender, concurrency=1)
    status = wait_finished(runner)
    runner.shutdown()
    assert [p.observed_seconds for p in sender.pulses] == [1.0, 2.0]
    assert status["sent"] == status["transport_accepted"] == 2
    assert status["server_confirmed"] is None
    assert status["tasks"][0]["state"] == "ended_locally"


def test_pause_resume_stop_requires_same_run_id():
    class Observer:
        def observe(self, _target):
            return None
    class Sender:
        def send(self, _pulse):
            raise AssertionError("no fake progress")

    runner = UCampusLocalRunner(interval=0.01)
    run_id = runner.start("course1", [task()], observer=Observer(), transport=Sender())["run_id"]
    with pytest.raises(ValueError):
        runner.control("pause", "wrong")
    assert runner.control("pause", run_id)["paused"]
    assert runner.control("resume", run_id)["paused"] is False
    assert runner.control("stop", run_id)["phase"] == "stopping"
    runner.shutdown()
    assert runner.status("different")["tasks"] == []


def test_invalid_targets_and_non_finite_positions_are_rejected():
    with pytest.raises(ValueError):
        MediaPosition(float("nan"), playing=True)
    with pytest.raises(ValueError):
        MediaTask("course1", "U1", "", "title")
    class Observer:
        def observe(self, _target): return None
    class Sender:
        def send(self, _pulse): return False
    runner = UCampusLocalRunner()
    with pytest.raises(ValueError):
        runner.start("course1", [task(), task()], observer=Observer(), transport=Sender())
