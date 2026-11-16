"""Offline tests for the fabricated U校园 heartbeat chain.

No real account, no network, no official player. Every transport, clock and
socket is injected. The wire-contract assertions mirror the reviewed upstream
implementations recorded in docs/UCAMPUS_INTEGRATION.md.
"""
from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

for _name in ("requests", "websocket", "keyring", "bs4"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        if _name == "requests":
            _stub.RequestException = type("RequestException", (Exception,), {})
        sys.modules[_name] = _stub

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from studyflow.platforms.ucampus import fabricated_heartbeat as fh
from studyflow.platforms.ucampus.fabricated_runner import FabricatedRunner
from studyflow.platforms.ucampus.fabricated_transport import (
    FabricatedReceipt, FabricatedTransport, progress_url,
)
from studyflow.services import ucampus_fabricated_bridge as bridge


def target(**kwargs):
    base = dict(course_id="course-v2:100", unit_id="u1", resource_id="leaf1",
                title="Unit 1 Video", duration_seconds=600.0,
                open_id="open1", tab_type="video")
    base.update(kwargs)
    return fh.FabricatedTarget(**base)


class FakeSocket:
    def __init__(self, reply: str = "unsolicited_event"):
        self.events: list[tuple[str, dict]] = []
        self.reply = reply
        self.closed = False

    def emit(self, event_name: str, event_data: dict) -> str:
        self.events.append((event_name, event_data))
        return self.reply

    def close(self) -> None:
        self.closed = True


class FakeTransport:
    def __init__(self, *, accepted=True, confirmed=True):
        self.accepted, self.confirmed = accepted, confirmed
        self.pulses: list = []
        self.opened = self.closed = False

    @property
    def connected(self):
        return True

    def open(self):
        self.opened = True

    def close(self):
        self.closed = True

    def send_result(self, pulse, target=None):
        self.pulses.append(pulse)
        if not pulse.completion:
            return FabricatedReceipt("sent", "socket_activity", False, None, 1,
                                     pulse.position_seconds, False, "unsolicited_event")
        return FabricatedReceipt(
            "confirmed" if self.confirmed else "accepted", "mark_seen_submit",
            self.accepted, self.confirmed if self.accepted else None, 1,
            pulse.position_seconds, True, "")


class TimelineTests(unittest.TestCase):
    def test_linear_positions_and_final_duration(self):
        line = fh.FabricatedTimeline(target(), 4)
        self.assertEqual([line.position(i) for i in range(1, 5)],
                         [150.0, 300.0, 450.0, 600.0])
        self.assertFalse(line.is_completion(3))
        self.assertTrue(line.is_completion(4))

    def test_pulse_carries_invented_position_not_wall_clock(self):
        line = fh.FabricatedTimeline(target(duration_seconds=120.0), 3)
        pulse = line.make_pulse(2, "run-a")
        self.assertEqual(pulse.position_seconds, 80.0)
        self.assertEqual(pulse.duration_seconds, 120.0)
        self.assertFalse(pulse.completion)
        self.assertAlmostEqual(pulse.progress(), 2 / 3)

    def test_speed_scales_only_wall_interval(self):
        line = fh.FabricatedTimeline(target(), 4, speed=4.0)
        self.assertAlmostEqual(line.wall_interval(20.0), 5.0)
        self.assertEqual(line.position(4), 600.0)

    def test_parameter_guards(self):
        with self.assertRaises(ValueError):
            fh.FabricatedTimeline(target(), 0)
        with self.assertRaises(ValueError):
            fh.FabricatedTimeline(target(), fh.MAX_PULSES + 1)
        with self.assertRaises(ValueError):
            fh.FabricatedTimeline(target(), 4, speed=100.0)
        with self.assertRaises(ValueError):
            fh.FabricatedTimeline(target(duration_seconds=0), 4)
        with self.assertRaises(ValueError):
            line = fh.FabricatedTimeline(target(), 4)
            line.position(5)


class PacketTests(unittest.TestCase):
    def test_activity_event_matches_legacy_socket_shape(self):
        line = fh.FabricatedTimeline(target(), 3)
        event = fh.build_activity_event(line.make_pulse(1, "r"), target())
        self.assertEqual(set(event), {"module", "moduleGroup", "client", "url",
                                      "tag1", "tag2"})
        self.assertEqual(event["client"], "U校园pc")
        self.assertEqual(event["moduleGroup"], "course-v2:100")
        self.assertEqual(event["tag1"], "u1")
        self.assertEqual(event["tag2"], "leaf1")
        self.assertTrue(event["url"].startswith("https://ucontent.unipus.cn/"))
        self.assertNotIn("position", event)
        self.assertNotIn("studyTime", event)

    def test_mark_seen_payload_is_upstream_exact(self):
        line = fh.FabricatedTimeline(target(), 2)
        packet = fh.build_mark_seen_payload(line.make_pulse(2, "r"))
        self.assertEqual(tuple(packet), fh.MARK_SEEN_KEYS)
        self.assertEqual(packet["submitType"], 2)
        self.assertIs(packet["hideLoading"], True)
        self.assertEqual(packet["quesDatas"], [])
        self.assertEqual(packet["isCompleted"], [])
        self.assertEqual(packet["thirdPartyJudges"], "[]")
        self.assertEqual(packet["groupId"], "leaf1")
        self.assertEqual(packet["courseId"], "course-v2:100")
        self.assertEqual(packet["openId"], "open1")
        self.assertEqual(packet["version"], "default")

    def test_mark_seen_url_is_upstream_endpoint(self):
        self.assertEqual(fh.MARK_SEEN_URL,
                         "https://ucontent.unipus.cn/course/api/v3/newExploration/submit")
        self.assertEqual(fh.SOCKET_NAMESPACE, "/userActivities")

    def test_target_from_progress_row_audio_duration(self):
        row = {"id": "audio1", "type": "audio", "title": "Listening",
               "completed": False, "duration": 95.5}
        made = fh.FabricatedTarget.from_progress_row(
            "course-v2:100", "u1", row, open_id="open1")
        self.assertEqual(made.dtype, "audio")
        self.assertEqual(made.duration_seconds, 95.5)
        self.assertEqual(made.tab_type, "audio")

    def test_target_rejects_bad_ids(self):
        with self.assertRaises(ValueError):
            target(resource_id="../escape").validate()
        with self.assertRaises(ValueError):
            target(dtype="document").validate()


class ResponseTests(unittest.TestCase):
    def test_submit_response_classification(self):
        S = fh.FabricatedSendState
        self.assertIs(fh.classify_submit_response({"code": 0}), S.ACCEPTED)
        self.assertIs(fh.classify_submit_response({"code": 600001}), S.RATE_LIMITED)
        self.assertIs(fh.classify_submit_response({"code": 600002}), S.RATE_LIMITED)
        self.assertIs(fh.classify_submit_response(
            {"code": 1, "msg": "操作过于频繁"}), S.RATE_LIMITED)
        self.assertIs(fh.classify_submit_response({"code": 401}), S.SESSION_EXPIRED)
        self.assertIs(fh.classify_submit_response({"code": 5}), S.REJECTED)
        self.assertIs(fh.classify_submit_response([]), S.PROTOCOL_ERROR)

    def test_progress_leaf_three_flag_readback(self):
        self.assertIs(fh.classify_progress_leaf(
            {"state": {"pass": 1, "pass2": 1, "perm": 1}}), True)
        self.assertIs(fh.classify_progress_leaf(
            {"state": {"pass": 0, "pass2": 0, "perm": 0}}), False)
        self.assertIs(fh.classify_progress_leaf(
            {"state": {"pass": 0}}), False)
        self.assertIs(fh.classify_progress_leaf(
            {"state": {"pass": 1}}), True)
        self.assertIsNone(fh.classify_progress_leaf({}))


class StateStoreTests(unittest.TestCase):
    def test_atomic_persistence_and_no_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            store = fh.FabricatedStateStore(Path(folder) / "state.json")
            store.save("run1", {"course_id": "course-v2:100",
                                "tasks": {"leaf1": {"generated": 3}}})
            self.assertEqual(store.load("run1")["tasks"]["leaf1"]["generated"], 3)
            raw = (Path(folder) / "state.json").read_text(encoding="utf-8")
            self.assertNotIn("cookie", raw.lower())
            self.assertNotIn("jwt", raw.lower())
            store.clear("run1")
            self.assertIsNone(store.load("run1"))
            self.assertEqual(list(Path(folder).glob(".ucampus-*")), [])


class TransportTests(unittest.TestCase):
    def _transport(self, *, posts=None, confirm_payload=None, socket=None,
                   reader=None, retries=2):
        calls: list[dict] = []
        sleeps: list[float] = []
        post_results = list(posts or [{"code": 0}])

        def post(url, payload, headers):
            calls.append({"url": url, "payload": payload})
            return post_results.pop(0) if post_results else {"code": 0}

        def get(url, headers):
            if confirm_payload is None:
                return {"rt": {"leafs": {}}}
            return confirm_payload

        tr = FabricatedTransport(
            reader=reader, post=post, get=get, sleep=sleeps.append,
            cooldown_seconds=180.0, max_retries=retries,
            headers={"Content-Type": "application/json"}, open_id="open1")
        tr._socket = socket
        return tr, calls, sleeps

    def test_intermediate_pulse_uses_socket_only(self):
        socket = FakeSocket()
        tr, calls, _ = self._transport(socket=socket)
        line = fh.FabricatedTimeline(target(), 3)
        receipt = tr.send_result(line.make_pulse(1, "r"), target())
        self.assertEqual(receipt.state, "sent")
        self.assertFalse(receipt.accepted)
        self.assertIsNone(receipt.server_confirmed)
        self.assertEqual(len(socket.events), 1)
        self.assertEqual(socket.events[0][0], "start")
        self.assertEqual(calls, [])

    def test_final_pulse_posts_mark_seen_and_confirms(self):
        tr, calls, _ = self._transport(
            confirm_payload={"rt": {"leafs": {"leaf1": {
                "state": {"pass": 1, "pass2": 1, "perm": 1}}}}})
        line = fh.FabricatedTimeline(target(), 2)
        receipt = tr.send_result(line.make_pulse(2, "r"))
        self.assertEqual(receipt.state, "confirmed")
        self.assertTrue(receipt.accepted)
        self.assertIs(receipt.server_confirmed, True)
        self.assertEqual(calls[0]["url"], fh.MARK_SEEN_URL)
        self.assertEqual(calls[0]["payload"]["submitType"], 2)

    def test_rate_limit_uses_escalating_cooldown(self):
        tr, calls, sleeps = self._transport(
            posts=[{"code": 600001}, {"code": 600002}, {"code": 0}], retries=3)
        line = fh.FabricatedTimeline(target(), 1)
        receipt = tr.send_result(line.make_pulse(1, "r"))
        self.assertTrue(receipt.accepted)
        self.assertEqual(receipt.attempts, 3)
        self.assertEqual(sleeps, [180.0, 360.0])

    def test_rate_limit_exhaustion_is_not_accepted(self):
        tr, _, sleeps = self._transport(
            posts=[{"code": 600001}] * 6, retries=2)
        line = fh.FabricatedTimeline(target(), 1)
        receipt = tr.send_result(line.make_pulse(1, "r"))
        self.assertEqual(receipt.state, "rate_limited")
        self.assertFalse(receipt.accepted)
        self.assertEqual(receipt.attempts, 3)
        self.assertEqual(len(sleeps), 2)

    def test_code_zero_without_readback_is_reported_not_confirmed(self):
        tr, _, _ = self._transport()
        line = fh.FabricatedTimeline(target(), 1)
        receipt = tr.send_result(line.make_pulse(1, "r"))
        self.assertEqual(receipt.state, "accepted")
        self.assertTrue(receipt.accepted)
        self.assertIsNone(receipt.server_confirmed)

    def test_socket_reply_is_never_completion_credit(self):
        socket = FakeSocket(reply="unmatched_ack")
        tr, _, _ = self._transport(socket=socket)
        line = fh.FabricatedTimeline(target(), 3)
        receipt = tr.send_result(line.make_pulse(1, "r"))
        self.assertEqual(receipt.socket_reply, "unmatched_ack")
        self.assertFalse(receipt.accepted)
        self.assertIsNone(receipt.server_confirmed)

    def test_progress_url_matches_upstream_shape(self):
        self.assertEqual(progress_url("course-v2:100", "u1", "open1"),
                         "https://ucontent.unipus.cn/course/api/v2/course_progress/"
                         "course-v2:100/u1/open1/default/")

    def test_reader_readback_path(self):
        class Reader:
            def list_tasks(self, course, unit):
                return [{"id": "leaf1", "completed": True}]
        tr, _, _ = self._transport(reader=Reader())
        tr._readback = False
        line = fh.FabricatedTimeline(target(), 1)
        self.assertIs(tr.confirm(line.make_pulse(1, "r")), True)


class RunnerTests(unittest.TestCase):
    def test_full_run_reports_confirmed_completion(self):
        fake = FakeTransport()
        runner = FabricatedRunner(transport_factory=lambda: fake)
        state = runner.start("course-v2:100", "u1", [target()], pulses=4,
                             heartbeat_interval=0.01)
        run_id = state["run_id"]
        self.assertTrue(runner.wait(3))
        state = runner.status("course-v2:100")
        runner.shutdown()
        self.assertEqual(state["run_id"], run_id)
        self.assertEqual(state["generated"], 4)
        self.assertEqual(state["sent"], 4)
        self.assertEqual(state["transport_accepted"], 1)
        self.assertEqual(state["server_confirmed"], 1)
        self.assertEqual(state["completed"], 1)
        self.assertEqual(state["phase"], "finished_locally")
        self.assertEqual(len(fake.pulses), 4)
        self.assertTrue(fake.pulses[-1].completion)
        self.assertEqual(fake.pulses[-1].position_seconds, 600.0)
        self.assertTrue(fake.opened and fake.closed)

    def test_instant_complete_skips_intermediate_heartbeats(self):
        fake = FakeTransport()
        runner = FabricatedRunner(transport_factory=lambda: fake)
        runner.start("course-v2:100", "u1", [target()], pulses=9,
                     instant_complete=True, heartbeat_interval=0.01)
        self.assertTrue(runner.wait(3))
        runner.shutdown()
        self.assertEqual(len(fake.pulses), 1)
        self.assertTrue(fake.pulses[0].completion)

    def test_pause_resume_stop_and_run_id_guard(self):
        fake = FakeTransport()
        runner = FabricatedRunner(transport_factory=lambda: fake)
        state = runner.start("course-v2:100", "u1", [target()], pulses=3,
                             heartbeat_interval=0.4)
        rid = state["run_id"]
        with self.assertRaises(ValueError):
            runner.control("pause", "0" * 32)
        runner.control("pause", rid)
        self.assertTrue(runner.status("course-v2:100")["paused"])
        runner.control("resume", rid)
        self.assertFalse(runner.status("course-v2:100")["paused"])
        runner.control("stop", rid)
        runner.shutdown()
        self.assertFalse(runner.status("course-v2:100")["active"])

    def test_already_running_is_rejected(self):
        runner = FabricatedRunner(transport_factory=FakeTransport)
        runner.start("course-v2:100", "u1", [target()], pulses=2,
                     heartbeat_interval=0.01)
        with self.assertRaises(Exception):
            runner.start("course-v2:100", "u1", [target()], pulses=2,
                         heartbeat_interval=0.01)
        runner.shutdown()

    def test_mismatched_course_scope_has_empty_status(self):
        runner = FabricatedRunner(transport_factory=FakeTransport)
        runner.start("course-v2:100", "u1", [target()], pulses=1,
                     heartbeat_interval=0.01)
        runner.shutdown()
        state = runner.status("course-v2:999")
        self.assertEqual(state["phase"], "idle")
        self.assertEqual(state["tasks"], [])
        self.assertEqual(state["run_id"], "")


class BridgeTests(unittest.TestCase):
    def test_capabilities_reports_no_player_needed(self):
        data = bridge.dispatch("ucampus.fabricated.capabilities", {})
        self.assertTrue(data["ok"])
        self.assertTrue(data["local_generation"])
        self.assertFalse(data["official_player_required"])
        self.assertEqual(data["completion_packet"],
                         "newExploration/submit submitType=2")

    def test_unknown_operation_returns_none(self):
        self.assertIsNone(bridge.dispatch("ucampus.heartbeat.status", {}))

    def test_start_validates_parameters(self):
        bad = bridge.dispatch("ucampus.fabricated.start",
                              {"course_id": "course-v2:100", "unit_id": "u1",
                               "pulses": 999})
        self.assertEqual(bad["error"], "UCAMPUS_INVALID_FABRICATED_PARAMETER")
        missing = bridge.dispatch("ucampus.fabricated.start", {})
        self.assertEqual(missing["error"], "UCAMPUS_COURSE_REQUIRED")

    def test_start_builds_targets_from_reader_and_registers_sender(self):
        bridge.reset_runner()
        rows = [{"id": "leaf1", "type": "video", "title": "Video",
                 "completed": False},
                {"id": "leaf2", "type": "audio", "title": "Audio",
                 "completed": False},
                {"id": "leaf3", "type": "video", "title": "Done",
                 "completed": True}]
        with mock.patch.object(bridge, "_session_open_id", return_value="open1"), \
             mock.patch.object(bridge, "UCampusProgressReader") as reader_cls, \
             mock.patch.object(bridge, "FabricatedTransport") as transport_cls:
            reader_cls.return_value.list_tasks.return_value = rows
            result = bridge.dispatch("ucampus.fabricated.start", {
                "course_id": "course-v2:100", "unit_id": "u1", "pulses": 2,
                "heartbeat_interval": 0.01, "duration_seconds": 300.0})
            self.assertTrue(result["ok"], result)
            self.assertEqual(len(result["tasks"]), 2)
            self.assertEqual(result["tasks"][0]["duration_seconds"], 300.0)
            transport_cls.assert_called_once()
        bridge.get_runner().shutdown()
        bridge.reset_runner()

    def test_run_id_mismatch_is_rejected(self):
        bad = bridge.dispatch("ucampus.fabricated.pause",
                              {"course_id": "course-v2:100", "run_id": "0" * 32})
        self.assertEqual(bad["error"], "UCAMPUS_RUN_ID_MISMATCH")


if __name__ == "__main__":
    unittest.main()


def test_uncaught_transport_exception_never_leaks_message_to_status():
    class SecretFailingTransport:
        connected = False
        def open(self):
            pass
        def send_result(self, pulse, target=None):
            raise RuntimeError("Cookie=PRIVATE_SECRET Authorization:Bearer PRIVATE_SECRET")
        def close(self):
            pass
    runner = FabricatedRunner(transport_factory=SecretFailingTransport)
    runner.start("course-v2:100", "u1", [target()], pulses=1,
                 heartbeat_interval=0.01)
    assert runner.wait(3)
    state = runner.status("course-v2:100")
    assert state["last_error"] == "UCAMPUS_RUN_FAILED"
    assert "PRIVATE_SECRET" not in repr(state)
    assert state["progress_causality"] == "unverified"
    assert state["source_kind"] == "synthetic_activity"


def test_socket_cleanup_exception_is_redacted_and_run_terminates():
    class SecretCloseTransport:
        connected = False
        def open(self): pass
        def send_result(self, pulse, target=None):
            from studyflow.platforms.ucampus.fabricated_transport import FabricatedReceipt
            return FabricatedReceipt(
                state="accepted", delivery="mark_seen_submit", accepted=True,
                server_confirmed=None, attempts=1,
                position_seconds=float(pulse.position_seconds), completion=True,
                socket_reply="")
        def close(self):
            raise RuntimeError("Authorization=VERY_PRIVATE_CREDENTIAL")
    runner=FabricatedRunner(transport_factory=SecretCloseTransport)
    runner.start("course-v2:100","u1",[target()],pulses=1,heartbeat_interval=0.01)
    assert runner.wait(3)
    state=runner.status("course-v2:100")
    assert state["phase"]=="failed"
    assert state["last_error"]=="UCAMPUS_CLEANUP_FAILED"
    assert "VERY_PRIVATE_CREDENTIAL" not in repr(state)
    assert state["restart_resume_supported"] is False
    assert state["snapshot_store_configured"] is False


def test_local_history_whitelists_values_and_never_restarts_worker():
    with tempfile.TemporaryDirectory() as folder:
        store = fh.FabricatedStateStore(Path(folder) / "history.json")
        store.save("run001", {"course_id":"course-v2:100","unit_id":"u1",
                              "phase":"running","cookie":"PRIVATE_COOKIE",
                              "tasks":{"v1":{"generated":4,"sent":2,"confirmed":1,
                                             "authorization":"PRIVATE_TOKEN"}}})
        store.save("run002", {"course_id":"other","tasks":{}})
        history=store.list_recent("course-v2:100")
        assert len(history)==1
        assert history[0]["phase"]=="interrupted"
        assert history[0]["resume_available"] is False
        assert history[0]["progress_causality"]=="unverified"
        assert history[0]["generated"]==4 and history[0]["sent"]==2
        assert "PRIVATE_COOKIE" not in repr(history)
        assert "PRIVATE_TOKEN" not in repr(history)
        assert store.load("run001")["phase"]=="running"
        raw=(Path(folder)/"history.json").read_text(encoding="utf-8")
        assert "PRIVATE_COOKIE" not in raw
        assert "PRIVATE_TOKEN" not in raw
        assert "authorization" not in raw.lower()
        assert "cookie" not in raw.lower()


def test_shutdown_before_first_run_never_writes_invalid_snapshot():
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as temp:
        file=Path(temp)/"history.json"
        runner=FabricatedRunner(state_store=fh.FabricatedStateStore(file))
        runner.shutdown()
        assert not file.exists()
        state=runner.status("course-v2:100")
        assert state["phase"]=="idle"
        assert state["snapshot_store_configured"] is True
        assert state["restart_resume_supported"] is False

def test_saved_local_history_uses_terminal_phase_without_replay():
    with tempfile.TemporaryDirectory() as folder:
        store = fh.FabricatedStateStore(Path(folder) / "state.json")
        runner = FabricatedRunner(
            transport_factory=FakeTransport, state_store=store
        )
        started = runner.start("course-v2:100", "u1", [target()], pulses=1,
                               heartbeat_interval=0.01)
        assert runner.wait(3)
        saved = store.load(started["run_id"])
        assert saved is not None
        assert saved["phase"] == "finished_locally"
        records = store.list_recent("course-v2:100")
        assert records[0]["phase"] == "finished_locally"
        assert records[0]["resume_available"] is False
        runner.shutdown()


def test_history_snapshot_disk_whitelist_strips_nested_secrets_and_legacy_fields():
    import json
    with tempfile.TemporaryDirectory() as folder:
        file=Path(folder)/"history.json"
        # A historical file may contain untrusted metadata. The next save
        # rewrites all entries using the strict local-counter schema.
        file.write_text(json.dumps({
            "oldrun":{"course_id":"course-v2:100","unit_id":"u1",
                      "phase":"running","cookie":"LEAKED_OLD_COOKIE",
                      "tasks":{"leaf1":{"generated":2,"sent":1,
                                        "last_error":"Bearer LEAKED_OLD_TOKEN"}}}
        }),encoding="utf-8")
        store=fh.FabricatedStateStore(file)
        store.save("newrun",{
            "course_id":"course-v2:100","unit_id":"u1","phase":"failed",
            "authorization":"LEAKED_NEW_AUTH",
            "tasks":{"leaf2":{"generated":4,"sent":3,
                              "confirmed":1,"title":"LEAKED_TITLE_SECRET",
                              "last_error":"LEAKED_ERROR_SECRET",
                              "accepted":True}}
        })
        text=file.read_text(encoding="utf-8")
        for secret in ("LEAKED_OLD_COOKIE","LEAKED_OLD_TOKEN",
                       "LEAKED_NEW_AUTH","LEAKED_TITLE_SECRET",
                       "LEAKED_ERROR_SECRET"):
            assert secret not in text
        assert store.load("newrun")["tasks"]["leaf2"]=={
            "generated":4,"sent":3,"accepted":0,"confirmed":1}
        rows=store.list_recent("course-v2:100")
        assert len(rows)==2
        assert rows[0]["generated"]==4 and rows[1]["generated"]==2
        assert all(row["resume_available"] is False for row in rows)
