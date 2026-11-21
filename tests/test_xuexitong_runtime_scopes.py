"""Offline isolation checks for the persistent Xuexitong diagnostic log API."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from studyflow.platforms.xuexitong.service import XuexitongHeartbeatService  # noqa: E402


class TestHeartbeatLogScopes(unittest.TestCase):
    def test_course_and_account_scoping(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            service = XuexitongHeartbeatService(
                os.path.join(folder, "state.json"),
                session_factory=lambda: object(),
                targets_provider=lambda _course: [],
            )
            service._course_key = "10:20:30"
            service._run_id = "run-a"
            service._account_marker = ""
            service._record("task.state", {"state": "running"})
            service._course_key = "40:50:60"
            service._run_id = "run-b"
            service._record("task.state", {"state": "finished"})
            service._account_marker = "other-account"
            service._record("task.state", {"state": "private"})

            first = service.handle("xuexitong.heartbeat.logs", {"course_id": "10:20:30"})
            second = service.handle("xuexitong.heartbeat.logs", {"course_id": "40:50:60"})
            self.assertTrue(first["ok"])
            self.assertTrue(second["ok"])
            self.assertEqual([event["state"] for event in first["events"]], ["running"])
            self.assertEqual([event["state"] for event in second["events"]], ["finished"])
            self.assertEqual(first["events"][0]["run_id"], "run-a")
            self.assertEqual(service.handle("xuexitong.heartbeat.logs", {"course_id": "10:20:30", "limit": 0})["events"], [])
            self.assertTrue(all("_account_marker" not in item for item in first["events"]))

    def test_no_records_from_unselected_account(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            service = XuexitongHeartbeatService(
                os.path.join(folder, "state.json"),
                session_factory=lambda: object(),
                targets_provider=lambda _course: [],
            )
            service._account_marker = "other-account"
            service._course_key = "10:20:30"
            service._record("task.state", {"state": "private"})
            result = service.handle("xuexitong.heartbeat.logs", {"course_id": "10:20:30"})
            self.assertEqual(result, {"ok": True, "events": []})


    def test_simultaneous_starts_reserve_one_slot_and_failed_start_releases_it(self) -> None:
        import threading

        discovery_entered = threading.Event()
        allow_failure = threading.Event()
        attempts: list[dict] = []

        def blocked_discovery(_course: str):
            discovery_entered.set()
            if not allow_failure.wait(5):
                raise RuntimeError("offline-discovery-timeout")
            raise RuntimeError("offline-discovery-error")

        with tempfile.TemporaryDirectory() as folder:
            service = XuexitongHeartbeatService(
                os.path.join(folder, "state.json"),
                session_factory=lambda: object(),
                targets_provider=blocked_discovery,
            )
            request = {"course_key": "10:20:30"}
            first = threading.Thread(
                target=lambda: attempts.append(service.handle("xuexitong.heartbeat.start", request)),
                daemon=True,
            )
            first.start()
            try:
                self.assertTrue(discovery_entered.wait(3), "first start did not enter discovery")
                concurrent = service.handle("xuexitong.heartbeat.start", request)
                self.assertEqual(concurrent, {
                    "ok": False, "error": "XUEXITONG_TASK_ALREADY_RUNNING"
                })
            finally:
                allow_failure.set()
                first.join(timeout=3)
            self.assertFalse(first.is_alive())
            self.assertEqual(attempts, [{
                "ok": False, "error": "XUEXITONG_INTERNAL_ERROR"
            }])
            self.assertFalse(service._starting, "failed discovery must release start reservation")
            # A failed attempt cannot permanently block a subsequent start.
            retry = service.handle("xuexitong.heartbeat.start", request)
            self.assertEqual(retry, {
                "ok": False, "error": "XUEXITONG_INTERNAL_ERROR"
            })

    def test_pause_controls_reflect_live_queue_state(self) -> None:
        import threading

        from studyflow.platforms.xuexitong.runner import ChapterQueue, RunConfig
        from studyflow.platforms.xuexitong.heartbeat import HeartbeatSender

        with tempfile.TemporaryDirectory() as folder:
            service = XuexitongHeartbeatService(
                os.path.join(folder, "state.json"),
                session_factory=lambda: object(),
                targets_provider=lambda _course: [],
            )
            gate = threading.Event()
            worker = threading.Thread(target=gate.wait, args=(2,), daemon=True)
            worker.start()
            queue = ChapterQueue(HeartbeatSender(object()), RunConfig())
            try:
                service._queue = queue
                service._thread = worker
                service._course_key = "10:20:30"
                service._run_id = "control-run"
                service._account_marker = ""

                running = service.handle("xuexitong.heartbeat.status", {"course_id": "10:20:30"})
                self.assertTrue(running["running"])
                self.assertFalse(running["paused"])
                self.assertEqual(running["queue_controls"],
                                 {"pause": True, "resume": False, "stop": True})

                queue.pause_all()
                paused = service.handle("xuexitong.heartbeat.status", {"course_id": "10:20:30"})
                self.assertTrue(paused["paused"])
                self.assertEqual(paused["queue_controls"],
                                 {"pause": False, "resume": True, "stop": True})

                different_course = service.handle("xuexitong.heartbeat.status", {"course_id": "40:50:60"})
                self.assertFalse(different_course["running"])
                self.assertFalse(different_course["paused"])
                self.assertEqual(different_course["queue_controls"],
                                 {"pause": False, "resume": False, "stop": False})

                queue.resume_all()
                resumed = service.handle("xuexitong.heartbeat.status", {"course_id": "10:20:30"})
                self.assertFalse(resumed["paused"])
                self.assertTrue(resumed["queue_controls"]["pause"])
            finally:
                gate.set()
                worker.join(timeout=3)



if __name__ == "__main__":
    unittest.main()
