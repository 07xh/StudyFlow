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


if __name__ == "__main__":
    unittest.main()
