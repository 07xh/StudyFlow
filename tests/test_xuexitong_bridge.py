"""长驻 Sidecar 心跳桥接层离线验证：不发真实请求、不写用户目录。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from studyflow.services import xuexitong_heartbeat_bridge as bridge  # noqa: E402


class FakeService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def handle(self, operation: str, payload: dict | None = None) -> dict:
        self.calls.append((operation, dict(payload or {})))
        return {"ok": True, "operation": operation, "echo": dict(payload or {})}

    def wait(self, timeout: float = 5.0) -> bool:
        self.calls.append(("__wait__", {"timeout": timeout}))
        return True


class TestHeartbeatBridge(unittest.TestCase):
    def setUp(self) -> None:
        self._original = bridge._SERVICE
        self.fake = FakeService()
        bridge._SERVICE = self.fake

    def tearDown(self) -> None:
        bridge._SERVICE = self._original

    def test_non_heartbeat_operation_is_not_intercepted(self) -> None:
        self.assertIsNone(bridge.dispatch("courses.list", {"platform": "xuexitong"}))
        self.assertEqual(self.fake.calls, [])

    def test_course_id_is_mapped_to_course_key(self) -> None:
        result = bridge.dispatch("xuexitong.heartbeat.start", {
            "id": "req-1", "version": 1,
            "operation": "xuexitong.heartbeat.start",
            "course_id": "100001:200002:300003",
            "speed": 1.5, "jobs": 2,
            "settings": {"playback_speed": 1.5},
        })
        self.assertTrue(result["ok"])
        operation, payload = self.fake.calls[0]
        self.assertEqual(operation, "xuexitong.heartbeat.start")
        self.assertEqual(payload["course_key"], "100001:200002:300003")
        self.assertNotIn("course_id", payload)
        self.assertNotIn("id", payload)
        self.assertNotIn("version", payload)
        self.assertEqual(payload["speed"], 1.5)

    def test_control_operations_forward_run_id(self) -> None:
        bridge.dispatch("xuexitong.heartbeat.pause", {
            "operation": "xuexitong.heartbeat.pause", "run_id": "run-abc",
        })
        self.assertEqual(self.fake.calls[0][1]["run_id"], "run-abc")

    def test_shutdown_stops_and_waits(self) -> None:
        bridge.shutdown()
        operations = [name for name, _payload in self.fake.calls]
        self.assertIn("xuexitong.heartbeat.stop", operations)
        self.assertIn("__wait__", operations)

    def test_state_path_is_user_scoped_and_versioned(self) -> None:
        path = bridge.state_path().replace("\\", "/")
        self.assertTrue(path.endswith("StudyFlow/xuexitong-heartbeat-state-v2.json"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
