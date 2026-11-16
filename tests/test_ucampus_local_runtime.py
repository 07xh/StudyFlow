"""U校园 locally generated heartbeats do not require the official player."""
import time
import pytest
from studyflow.platforms.ucampus.local_runtime import MediaTask, UCampusLocalRunner


def task(chapter="U1", resource="R1"):
    return MediaTask("course1", chapter, resource, "本地章节资源")


def until_done(runner):
    for _ in range(200):
        state = runner.status("course1")
        if state["phase"] in ("finished_locally", "failed"):
            return state
        time.sleep(0.005)
    raise AssertionError("local heartbeat task timed out")


def test_local_generation_requires_no_player_or_sender():
    runner = UCampusLocalRunner(interval=0.01)
    runner.start("course1", [task()], pulses_per_resource=2)
    status = until_done(runner)
    runner.shutdown()
    assert status["phase"] == "finished_locally"
    assert status["generated"] == 2
    assert status["sent"] == 0
    assert status["server_confirmed"] is None
    assert status["tasks"][0]["local_elapsed_seconds"] > 0


def test_sender_is_independent_and_server_completion_is_unknown():
    class Sender:
        def __init__(self):
            self.pulses = []
        def send(self, pulse):
            self.pulses.append(pulse)
            return True

    sender = Sender()
    runner = UCampusLocalRunner(interval=0.01)
    runner.start("course1", [task()], transport=sender, pulses_per_resource=3)
    status = until_done(runner)
    runner.shutdown()
    assert [p.sequence for p in sender.pulses] == [1, 2, 3]
    assert status["generated"] == status["sent"] == status["transport_accepted"] == 3
    assert status["server_confirmed"] is None
    assert sender.pulses[0].local_elapsed_seconds > 0


def test_parallel_chapters_and_sequential_resources():
    runner = UCampusLocalRunner(interval=0.01)
    runner.start("course1", [task("U1", "A"), task("U2", "B"), task("U1", "C")],
                 concurrency=2, pulses_per_resource=2)
    status = until_done(runner)
    runner.shutdown()
    assert status["generated"] == 6
    assert [t["state"] for t in status["tasks"]] == ["finished_locally"] * 3


def test_pause_resume_stop_is_scoped_to_run():
    runner = UCampusLocalRunner(interval=0.05)
    run = runner.start("course1", [task()], pulses_per_resource=50)["run_id"]
    with pytest.raises(ValueError):
        runner.control("pause", "other-run")
    assert runner.control("pause", run)["paused"]
    assert runner.control("resume", run)["paused"] is False
    assert runner.control("stop", run)["phase"] in ("stopping", "stopped")
    runner.shutdown()
    assert runner.status("another-course")["generated"] == 0


def test_input_validation():
    with pytest.raises(ValueError):
        MediaTask("course1", "U1", "", "title")
    runner = UCampusLocalRunner()
    with pytest.raises(ValueError):
        runner.start("course1", [task(), task()])
    with pytest.raises(ValueError):
        runner.start("course1", [task()], pulses_per_resource=0)


def test_blocked_transport_does_not_serialize_other_chapters():
    """A slow local fake sender must not hold the global scheduler lock."""
    import threading
    count = 0
    gate = threading.Lock()
    both_inside = threading.Event()
    release = threading.Event()

    class SlowLocalSender:
        def send(self, _pulse):
            nonlocal count
            with gate:
                count += 1
                if count == 2:
                    both_inside.set()
            release.wait(timeout=2)
            return True

    runner = UCampusLocalRunner(interval=0.01)
    try:
        runner.start("course1", [task("U1", "A"), task("U2", "B")],
                     transport=SlowLocalSender(), concurrency=2, pulses_per_resource=1)
        assert both_inside.wait(timeout=1), "chapters were accidentally serialized"
        # The UI-facing status path must also remain responsive while both
        # transport adapters are intentionally blocked by the fixture.
        assert runner.status("course1")["sent"] == 2
    finally:
        release.set()
        runner.shutdown()
    status = runner.status("course1")
    assert status["sent"] == status["transport_accepted"] == 2
    assert status["server_confirmed"] is None


def test_local_status_exposes_event_target_without_any_server_credit():
    runner = UCampusLocalRunner(interval=0.01)
    try:
        runner.start("course1", [task("U1", "A"), task("U1", "B")],
                     pulses_per_resource=3)
        status = until_done(runner)
        assert status["pulses_per_resource"] == 3
        assert len(status["tasks"]) == 2
        assert status["generated"] == 6
        assert all(row["generated"] == 3 for row in status["tasks"])
        assert status["sent"] == 0
        assert status["server_confirmed"] is None
        other = runner.status("another-course")
        assert other["pulses_per_resource"] == 0
        assert other["generated"] == 0
    finally:
        runner.shutdown()
