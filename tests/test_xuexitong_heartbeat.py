"""本地心跳模块离线验证：全部使用注入的假 session / 假时钟，不发真实请求。

运行：
    python -m unittest discover -s tests -p "test_xuexitong_heartbeat.py" -v
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from studyflow.platforms.xuexitong.heartbeat import (  # noqa: E402
    ENC_SALT,
    HeartbeatSender,
    RateLimiter,
    SendState,
    VideoTarget,
    build_completion_packet,
    build_enc,
    build_packet,
    identity_from_cookies,
    resolve_rt,
)
from studyflow.platforms.xuexitong.runner import (  # noqa: E402
    ChapterQueue,
    HeartbeatTaskRunner,
    RunConfig,
    TaskState,
)
from studyflow.platforms.xuexitong.state import StateStore, TaskSnapshot  # noqa: E402


def make_target(**overrides: object) -> VideoTarget:
    values = dict(
        course_key="100001:200002:300003",
        chapter_id="9001",
        chapter="第一章",
        title="视频任务 A",
        clazz_id="200002",
        course_id="100001",
        cpi="300003",
        job_id="job-001",
        object_id="object-001",
        other_info="nodeId_9001-rt_1",
        duration=600,
        initial_seconds=0,
        dtoken="dtoken-abc",
        rt=0.9,
        userid="12345678",
        fid="1024",
    )
    values.update(overrides)
    return VideoTarget(**values)  # type: ignore[arg-type]


class FakeResponse:
    def __init__(self, status: int = 200, payload: object = None, text: str | None = None) -> None:
        self.status_code = status
        self._payload = payload
        self.text = text if text is not None else (
            "OK" if payload is None else __import__("json").dumps(payload, ensure_ascii=False)
        )

    def json(self) -> object:
        if self._payload is None:
            raise ValueError("no json")
        if self._payload == "BROKEN":
            raise ValueError("broken json")
        return self._payload


class FakeSession:
    def __init__(self, responses: list[object] | None = None, *, on_get=None) -> None:
        self._responses = list(responses or [])
        self.calls: list[dict] = []
        self.on_get = on_get

    def get(self, url: str, *, params: dict, headers: dict, timeout: tuple) -> FakeResponse:
        self.calls.append({"url": url, "params": dict(params), "headers": dict(headers), "timeout": timeout})
        if self.on_get is not None:
            self.on_get(self)
        if self._responses:
            item = self._responses.pop(0)
        else:
            item = FakeResponse(payload={"isPassed": False})
        if isinstance(item, Exception):
            raise item
        return item  # type: ignore[return-value]


class FakeClock:
    def __init__(self, start: float = 1000.0, real_delay: float = 0.0) -> None:
        self.t = start
        self.real_delay = real_delay

    def __call__(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds
        if self.real_delay:
            time.sleep(self.real_delay)


def quiet_limiter() -> RateLimiter:
    return RateLimiter(clock=lambda: 0.0, sleeper=lambda _seconds: None)


def make_sender(session: FakeSession, *, limiter=None, clock=None) -> HeartbeatSender:
    return HeartbeatSender(
        session,
        limiter=limiter or quiet_limiter(),
        clock=clock or (lambda: 1000.0),
    )


class TestPacketGeneration(unittest.TestCase):
    def test_enc_matches_upstream_formula(self) -> None:
        target = make_target()
        expected = hashlib.md5(
            f"[200002][12345678][job-001][object-001][600000]"
            f"[{ENC_SALT}][600000][0_600]".encode()
        ).hexdigest()
        self.assertEqual(build_enc("200002", "job-001", "object-001", 600, 600, "12345678"), expected)
        packet = build_completion_packet(target)
        self.assertEqual(packet.params["enc"], expected)
        self.assertNotEqual(
            packet.params["enc"],
            build_enc("200002", "job-001", "object-001", 300, 600, "12345678"),
        )

    def test_completion_packet_claims_full_duration(self) -> None:
        target = make_target()
        packet = build_completion_packet(target, timestamp_ms="1700000000000")
        self.assertEqual(packet.params["playingTime"], 600)
        self.assertEqual(packet.params["duration"], 600)
        self.assertEqual(packet.params["isdrag"], 4)
        self.assertEqual(packet.params["clipTime"], "0_600")
        self.assertEqual(packet.params["dtype"], "Video")
        self.assertEqual(packet.params["view"], "pc")
        self.assertEqual(packet.params["_t"], "1700000000000")
        self.assertTrue(packet.claims_completion)
        self.assertTrue(packet.url.endswith("/300003/dtoken-abc"))

    def test_arbitrary_playing_time_packet(self) -> None:
        target = make_target()
        packet = build_packet(target, 137)
        self.assertEqual(packet.params["playingTime"], 137)
        self.assertEqual(packet.params["isdrag"], 3)
        self.assertFalse(packet.claims_completion)

    def test_params_cover_upstream_fields(self) -> None:
        packet = build_completion_packet(make_target())
        expected = {
            "clazzId", "playingTime", "duration", "clipTime", "objectId",
            "otherInfo", "courseId", "jobid", "userid", "isdrag", "view",
            "enc", "dtype", "rt", "_t",
        }
        self.assertTrue(expected.issubset(packet.params.keys()))
        self.assertEqual(packet.params["rt"], "0.9")
        self.assertEqual(packet.headers["Referer"],
                         "https://mooc1.chaoxing.com/ananas/modules/video/index.html?v=2025-0725-1842")

    def test_optional_face_and_att_fields(self) -> None:
        target = make_target(face_enc="face-enc", att_duration_enc="att-enc", att_duration=610)
        packet = build_completion_packet(target)
        self.assertEqual(packet.params["videoFaceCaptureEnc"], "face-enc")
        self.assertEqual(packet.params["attDurationEnc"], "att-enc")
        self.assertEqual(packet.params["attDuration"], 610)

    def test_rt_resolution(self) -> None:
        self.assertEqual(resolve_rt(make_target(rt=0.9)), "0.9")
        self.assertEqual(resolve_rt(make_target(rt=0.0, other_info="x-rt_d-y")), "0.9")
        self.assertEqual(resolve_rt(make_target(rt=0.0, other_info="x-rt_1-y")), "1")
        self.assertEqual(resolve_rt(make_target(rt=0.0, other_info="plain")), "")

    def test_validation_rejects_bad_targets(self) -> None:
        with self.assertRaises(ValueError):
            build_completion_packet(make_target(duration=0))
        with self.assertRaises(ValueError):
            build_packet(make_target(), 601)
        with self.assertRaises(ValueError):
            build_packet(make_target(), -1)
        with self.assertRaises(ValueError):
            build_completion_packet(make_target(other_info="courseId=1"))
        with self.assertRaises(ValueError):
            build_completion_packet(make_target(), dtype="Slides")
        with self.assertRaises(ValueError):
            identity_from_cookies({"fid": "1024"})

    def test_identity_from_cookies(self) -> None:
        self.assertEqual(identity_from_cookies({"_uid": "42", "fid": "2048"}), ("42", "2048"))
        self.assertEqual(identity_from_cookies({"UID": "43"}), ("43", "1024"))

    def test_public_dict_leaks_no_credentials(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": True})])
        result = make_sender(session).send(build_completion_packet(make_target()))
        public = result.public_dict()
        serialized = repr(public)
        for secret in ("dtoken-abc", "enc", "12345678", "mooc1.chaoxing.com", "nodeId_9001"):
            self.assertNotIn(secret, serialized)


class TestResponseClassification(unittest.TestCase):
    def test_confirmed(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": True})])
        result = make_sender(session).send(build_completion_packet(make_target()))
        self.assertEqual(result.state, SendState.CONFIRMED)
        self.assertTrue(result.sent)
        self.assertTrue(result.server_confirmed)
        self.assertTrue(result.completed)
        self.assertEqual(result.http_status, 200)

    def test_reported_is_not_completion(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": False})])
        result = make_sender(session).send(build_completion_packet(make_target()))
        self.assertEqual(result.state, SendState.REPORTED)
        self.assertTrue(result.sent, "本地已发出请求")
        self.assertFalse(result.server_confirmed, "服务端未确认完成")
        self.assertFalse(result.completed)

    def test_forbidden_captcha_session_expired(self) -> None:
        cases = [
            (FakeResponse(status=403, text="blocked"), SendState.FORBIDDEN),
            (FakeResponse(status=200, text="请输入验证码", payload=None), SendState.CAPTCHA),
            (FakeResponse(status=200, text="https://passport2.chaoxing.com/login", payload=None), SendState.SESSION_EXPIRED),
            (FakeResponse(status=500, text="oops"), SendState.HTTP_ERROR),
        ]
        for response, expected in cases:
            with self.subTest(expected=expected):
                result = make_sender(FakeSession([response])).send(build_completion_packet(make_target()))
                self.assertEqual(result.state, expected)
                self.assertFalse(result.server_confirmed)

    def test_protocol_error_and_network_error(self) -> None:
        broken = make_sender(FakeSession([FakeResponse(payload="BROKEN")]))
        self.assertEqual(broken.send(build_completion_packet(make_target())).state, SendState.PROTOCOL_ERROR)
        missing = make_sender(FakeSession([FakeResponse(payload={"result": 1})]))
        self.assertEqual(missing.send(build_completion_packet(make_target())).state, SendState.PROTOCOL_ERROR)
        offline = make_sender(FakeSession([ConnectionError("offline")]))
        result = offline.send(build_completion_packet(make_target()))
        self.assertEqual(result.state, SendState.NETWORK_ERROR)
        self.assertFalse(result.sent)

    def test_rt_fallback_tries_both_values(self) -> None:
        target = make_target(rt=0.0, other_info="plain")
        session = FakeSession([
            FakeResponse(status=403, text="blocked"),
            FakeResponse(payload={"isPassed": True}),
        ])
        result = make_sender(session).send_with_rt_fallback(target, 600, completion=True)
        self.assertEqual(result.state, SendState.CONFIRMED)
        self.assertEqual([call["params"]["rt"] for call in session.calls], ["0.9", "1"])
        self.assertEqual(result.attempts, 2)

    def test_rate_limiter_spacing(self) -> None:
        clock = FakeClock()
        waits: list[float] = []
        limiter = RateLimiter(2.0, clock=clock, sleeper=waits.append)
        limiter.limit_rate(random_time=False)
        limiter.limit_rate(random_time=False)
        self.assertGreaterEqual(sum(waits), 2.0)


class TestRunner(unittest.TestCase):
    def test_instant_completion_confirmed(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": True})])
        clock = FakeClock()
        config = RunConfig(instant_complete=True, heartbeat_interval_video_seconds=30,
                           tick_seconds=10, max_ticks=8, speed=1.0)
        runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                     config, clock=clock, sleeper=clock.sleep)
        snapshot = runner.start()
        self.assertEqual(snapshot.state, TaskState.SUCCEEDED.value)
        self.assertTrue(snapshot.server_confirmed)
        self.assertTrue(snapshot.confirmed)
        self.assertEqual(session.calls[0]["params"]["playingTime"], 600)
        self.assertEqual(session.calls[0]["params"]["isdrag"], 4)

    def test_unconfirmed_never_reports_completed(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": False})])
        clock = FakeClock()
        config = RunConfig(instant_complete=True, heartbeat_interval_video_seconds=30,
                           tick_seconds=10, max_ticks=4, speed=1.0)
        runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                     config, clock=clock, sleeper=clock.sleep)
        snapshot = runner.start()
        self.assertNotEqual(snapshot.state, TaskState.SUCCEEDED.value)
        self.assertFalse(snapshot.confirmed)
        self.assertFalse(snapshot.server_confirmed)
        self.assertEqual(snapshot.last_send_state, SendState.REPORTED.value)

    def test_speed_changes_reported_playing_time(self) -> None:
        for speed, expected_seconds in [(1.0, 30), (2.0, 40)]:
            with self.subTest(speed=speed):
                session = FakeSession([FakeResponse(payload={"isPassed": False})])
                clock = FakeClock()
                config = RunConfig(instant_complete=False, speed=speed,
                                   heartbeat_interval_video_seconds=30,
                                   tick_seconds=10, max_ticks=4)
                runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                             config, clock=clock, sleeper=clock.sleep)
                runner.start()
                self.assertEqual(session.calls[0]["params"]["playingTime"], expected_seconds)

    def test_config_validation(self) -> None:
        # 速度范围已对齐 settings.py v1（0.25–2.0），0.5 是合法值
        for bad in (dict(speed=0.1), dict(speed=2.5),
                    dict(heartbeat_interval_video_seconds=10),
                    dict(heartbeat_interval_video_seconds=120),
                    dict(max_workers=0), dict(max_workers=5), dict(dtype="Slides")):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    RunConfig(**bad).validate()

    def test_pause_resume_stop(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": False})])
        clock = FakeClock(real_delay=0.003)
        first_packet = threading.Event()

        def on_event(name: str, _payload: dict) -> None:
            if name == "heartbeat.sent":
                first_packet.set()

        config = RunConfig(instant_complete=True, heartbeat_interval_video_seconds=30,
                           tick_seconds=1, speed=1.0)
        runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                     config, on_event=on_event, clock=clock, sleeper=clock.sleep)
        thread = threading.Thread(target=runner.start, daemon=True)
        thread.start()
        self.assertTrue(first_packet.wait(timeout=2), "首包未在 2s 内发出")
        runner.pause()
        self.assertEqual(runner.state, TaskState.PAUSED.value)
        runner.resume()
        self.assertEqual(runner.state, TaskState.RUNNING.value)
        runner.stop()
        thread.join(timeout=3)
        self.assertEqual(runner.state, TaskState.STOPPED.value)
        self.assertFalse(runner.snapshot.confirmed)

    def test_failed_network_call_is_not_counted_as_sent(self) -> None:
        target = make_target()
        session = FakeSession([OSError("offline")])
        runner = HeartbeatTaskRunner(target, make_sender(session), RunConfig(instant_complete=False))
        runner._send(build_packet(target, 12))
        self.assertEqual(runner.snapshot.sent_count, 0)
        self.assertEqual(runner.snapshot.last_send_state, SendState.NETWORK_ERROR.value)

    def test_state_persistence_is_scoped_by_account(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            store = StateStore(os.path.join(folder, "state.json"))
            first = TaskSnapshot(task_id="same", account_marker="account-a",
                                 course_key="course", run_id="r1", playing_time=40)
            second = TaskSnapshot(task_id="same", account_marker="account-b",
                                  course_key="course", run_id="r2", playing_time=4)
            store.save(first)
            store.save(second)
            self.assertEqual(store.load("same", "account-a").playing_time, 40)
            self.assertEqual(store.load("same", "account-b").playing_time, 4)
            self.assertIsNone(store.load("same", "unknown"))
            self.assertEqual(len(store.list_by_course("course", "account-a")), 1)
            self.assertEqual(len(store.list_by_run("r2", "account-a")), 0)
            raw = Path(store.path).read_text(encoding="utf-8")
            self.assertNotIn("dtoken", raw)

    def test_state_persistence_and_resume(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            store = StateStore(os.path.join(folder, "state.json"))
            session = FakeSession([FakeResponse(payload={"isPassed": False})])
            clock = FakeClock()
            config = RunConfig(instant_complete=False, heartbeat_interval_video_seconds=30,
                               tick_seconds=10, max_ticks=3, speed=2.0)
            runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                         config, store=store, clock=clock, sleeper=clock.sleep)
            snapshot = runner.start()
            loaded = store.load(snapshot.task_id)
            self.assertIsNotNone(loaded)
            self.assertGreaterEqual(loaded.playing_time, 40)
            self.assertEqual(loaded.last_send_state, SendState.REPORTED.value)
            self.assertEqual(loaded.speed, 2.0)
            self.assertTrue(loaded.resumable)
            raw = Path(store.path).read_text(encoding="utf-8")
            for secret in ("dtoken-abc", "12345678", "d_yHJ"):
                self.assertNotIn(secret, raw)

            resumed = HeartbeatTaskRunner(
                make_target(), make_sender(FakeSession(), clock=clock), config,
                store=store, clock=clock, sleeper=clock.sleep,
                resume_playing_time=loaded.playing_time,
            )
            self.assertEqual(resumed.snapshot.playing_time, loaded.playing_time)
            store.clear(snapshot.task_id)
            self.assertIsNone(store.load(snapshot.task_id))


class TestChapterQueue(unittest.TestCase):
    @staticmethod
    def queue_config(**overrides: object) -> RunConfig:
        values = dict(max_ticks=6, tick_seconds=0.01, instant_complete=True,
                      heartbeat_interval_video_seconds=30, max_workers=1)
        values.update(overrides)
        return RunConfig(**values)  # type: ignore[arg-type]

    def test_chapter_order_and_no_duplicate_submit(self) -> None:
        targets = [make_target(object_id="v1", job_id="j1"), make_target(object_id="v2", job_id="j2")]
        session = FakeSession([FakeResponse(payload={"isPassed": True}),
                               FakeResponse(payload={"isPassed": True})])
        queue = ChapterQueue(make_sender(session), self.queue_config())
        self.assertTrue(queue.submit_chapter("c1", targets))
        self.assertFalse(queue.submit_chapter("c1", targets))
        results = queue.run()
        self.assertEqual(len(results), 2)
        self.assertEqual([c["params"]["objectId"] for c in session.calls], ["v1", "v2"])
        self.assertTrue(all(s.state == TaskState.SUCCEEDED.value for s in results.values()))

    def test_pause_before_queue_start_blocks_all_chapters(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": True})])
        queue = ChapterQueue(
            make_sender(session),
            self.queue_config(max_workers=1, instant_complete=True),
        )
        queue.submit_chapter("c1", [make_target(object_id="later", job_id="j-later")])
        queue.pause_all()
        results = {}

        def execute() -> None:
            results.update(queue.run())

        thread = threading.Thread(target=execute, daemon=True)
        thread.start()
        try:
            time.sleep(0.08)
            self.assertEqual(session.calls, [], "暂停时不得启动队列中的章节")
            self.assertTrue(thread.is_alive())
        finally:
            queue.resume_all()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(len(results), 1)

    def test_stop_wakes_queued_pause_without_network_work(self) -> None:
        session = FakeSession([])
        queue = ChapterQueue(make_sender(session), self.queue_config())
        queue.submit_chapter("c1", [make_target(object_id="later", job_id="j-later")])
        queue.pause_all()
        thread = threading.Thread(target=queue.run, daemon=True)
        thread.start()
        try:
            time.sleep(0.05)
            queue.stop_all()
            thread.join(3)
        finally:
            queue.resume_all()
        self.assertFalse(thread.is_alive())
        self.assertEqual(session.calls, [])

    def test_chapters_run_concurrently(self) -> None:
        barrier = threading.Barrier(2, timeout=3)
        arrived: list[str] = []
        lock = threading.Lock()

        def on_get(session: FakeSession) -> None:
            with lock:
                arrived.append(session.calls[-1]["params"]["objectId"])
            barrier.wait()

        session = FakeSession([FakeResponse(payload={"isPassed": True}),
                               FakeResponse(payload={"isPassed": True})], on_get=on_get)
        queue = ChapterQueue(make_sender(session), self.queue_config(max_workers=2))
        queue.submit_chapter("c1", [make_target(object_id="v1", job_id="j1")])
        queue.submit_chapter("c2", [make_target(object_id="v2", job_id="j2")])
        results = queue.run()
        self.assertEqual(len(arrived), 2, "两个独立章节必须并发进入心跳发送")
        self.assertEqual(len(results), 2)

    def test_failure_isolation(self) -> None:
        session = FakeSession([FakeResponse(status=403, text="blocked"),
                               FakeResponse(payload={"isPassed": True})])
        events: list[str] = []
        queue = ChapterQueue(
            make_sender(session), self.queue_config(),
            on_event=lambda name, _payload: events.append(name),
        )
        queue.submit_chapter("c1", [make_target(object_id="v1", job_id="j1")])
        queue.submit_chapter("c2", [make_target(object_id="v2", job_id="j2")])
        results = queue.run()
        self.assertEqual(len(results), 2)
        states = {s.task_id: s.state for s in results.values()}
        self.assertIn(TaskState.FAILED.value, states.values())
        self.assertIn(TaskState.SUCCEEDED.value, states.values())


class TestSidecarService(unittest.TestCase):
    def make_service(self, folder: str, targets: list, responses: list):
        from studyflow.platforms.xuexitong.service import XuexitongHeartbeatService

        session = FakeSession(responses)
        clock = FakeClock()
        return XuexitongHeartbeatService(
            os.path.join(folder, "state.json"),
            session_factory=lambda: session,
            targets_provider=lambda _key: targets,
            clock=clock,
            sleeper=lambda _seconds: None,
        )

    def test_start_status_logs_and_public_output(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            targets = [
                make_target(object_id="v1", job_id="j1", chapter_id="c1"),
                make_target(object_id="v2", job_id="j2", chapter_id="c2"),
            ]
            service = self.make_service(
                folder, targets,
                [FakeResponse(payload={"isPassed": True}), FakeResponse(payload={"isPassed": True})],
            )
            started = service.handle("xuexitong.heartbeat.start", {
                "course_key": "100001:200002:300003", "speed": 1.5, "jobs": 2,
                "instant_complete": True,  # This fixture's clock is intentionally static.
            })
            self.assertTrue(started["ok"])
            self.assertEqual(started["task_count"], 2)
            self.assertEqual(started["chapter_count"], 2)
            self.assertEqual(started["speed"], 1.5)

            self.assertTrue(service.wait(5), "后台队列未在 5s 内结束")
            status = service.handle("xuexitong.heartbeat.status")
            self.assertFalse(status["running"])
            self.assertEqual(status["config"]["speed"], 1.5)
            self.assertEqual(status["config"]["jobs"], 2)
            self.assertEqual(status["heartbeats"]["server_confirmed"], 2)
            self.assertTrue(all(task["server_confirmed"] for task in status["tasks"]))
            self.assertTrue(all(task["state"] == "succeeded" for task in status["tasks"]))

            logs = service.handle("xuexitong.heartbeat.logs", {"limit": 20})
            names = [entry["event"] for entry in logs["events"]]
            self.assertIn("service.started", names)
            self.assertIn("heartbeat.sent", names)
            self.assertIn("service.finished", names)

            serialized = repr(started) + repr(status) + repr(logs)
            for secret in ("dtoken-abc", "12345678", "mooc1.chaoxing.com", "d_yHJ"):
                self.assertNotIn(secret, serialized)

    def test_ipc_error_codes(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            service = self.make_service(folder, [], [])
            self.assertEqual(
                service.handle("xuexitong.heartbeat.start", {})["error"],
                "XUEXITONG_COURSE_REQUIRED",
            )
            self.assertEqual(
                service.handle("nope", {})["error"],
                "XUEXITONG_UNKNOWN_OPERATION",
            )
            self.assertEqual(
                service.handle("xuexitong.heartbeat.start", {
                    "course_key": "1:2:3", "speed": 9.0,
                })["error"],
                "XUEXITONG_INVALID_PARAMETER",
            )
            self.assertEqual(
                service.handle("xuexitong.heartbeat.pause", {})["error"],
                "XUEXITONG_NO_ACTIVE_TASK",
            )
            self.assertTrue(service.handle("xuexitong.heartbeat.status")["ok"])

    def test_pause_and_stop_controls(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            targets = [make_target(object_id="v1", job_id="j1")]
            service = self.make_service(folder, targets, [FakeResponse(payload={"isPassed": True})])
            started = service.handle("xuexitong.heartbeat.start", {
                "course_key": "1:2:3", "instant_complete": True,
            })
            self.assertTrue(started["ok"])
            pause = service.handle("xuexitong.heartbeat.pause", {})
            logs = service.handle("xuexitong.heartbeat.logs", {})
            names = [entry["event"] for entry in logs["events"]]
            self.assertIn("service.pause", names)
            self.assertTrue(pause["ok"] or pause["error"] == "XUEXITONG_NO_ACTIVE_TASK")
            service.handle("xuexitong.heartbeat.resume", {})
            self.assertTrue(service.wait(5), "后台队列未在 5s 内结束")


class TestPacingAndParsing(unittest.TestCase):
    """审计整改：统一解析、随机节奏、只读状态校准。"""

    def test_marg_parser_handles_nested_json_and_quoted_brace(self) -> None:
        from studyflow.platforms.xuexitong.taskparse import (
            extract_marg_payload, iter_media_cards,
        )
        html = (
            '<script>var mArg = {"attachments":[{"type":"video","objectId":"o1",'
            '"jobid":"j1","property":{"name":"a};b","rt":0.9},'
            '"otherInfo":"nodeId_1-rt_1&x=2"}],"defaults":{"k":"v"}}; </script>'
        )
        payload = extract_marg_payload(html)
        self.assertIsInstance(payload, dict)
        cards = list(iter_media_cards(payload))
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["object_id"], "o1")
        self.assertEqual(cards[0]["title"], "a};b")
        self.assertEqual(cards[0]["other_info"], "nodeId_1-rt_1")
        # 旧的浅正则会在字符串里的 '};' 处截断
        shallow = re.search(r"\bmArg\s*=\s*(\{.*?\})\s*;", html, re.S)
        self.assertIsNotNone(shallow)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(shallow.group(1))  # type: ignore[union-attr]
        # mArg 赋值不带分号时浅正则只能截到字符串里的 '};'，平衡解析仍读完整对象
        no_semicolon = html.replace("}}; </script>", "}} </script>")
        self.assertEqual(len(list(iter_media_cards(extract_marg_payload(no_semicolon)))), 1)
        shallow2 = re.search(r"\bmArg\s*=\s*(\{.*?\})\s*;", no_semicolon, re.S)
        self.assertIsNotNone(shallow2)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(shallow2.group(1))  # type: ignore[union-attr]

    def test_stringified_marg_and_field_aliases(self) -> None:
        from studyflow.platforms.xuexitong.taskparse import (
            extract_marg_payload, iter_media_cards,
        )
        payload = extract_marg_payload(
            "mArg = '{\"attachments\":[{\"type\":\"Video\",\"objectid\":\"o2\","
            "\"property\":{\"jobid\":\"j2\",\"name\":\"任务二\"},\"playTime\":30000}]}';"
        )
        self.assertIsInstance(payload, dict)
        cards = list(iter_media_cards(payload))
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["object_id"], "o2")
        self.assertEqual(cards[0]["job_id"], "j2")
        self.assertEqual(cards[0]["play_time_ms"], 30000)

    def test_random_interval_matches_upstream_range(self) -> None:
        from studyflow.platforms.xuexitong.pacing import PacingPolicy
        policy = PacingPolicy(rng=random.Random(42))
        values = [policy.next_interval() for _ in range(50)]
        self.assertTrue(all(30.0 <= value <= 90.0 for value in values))
        self.assertGreater(len(set(values)), 1, "每次上报必须重新抽取间隔")

    def test_status_playtime_milliseconds_are_converted(self) -> None:
        from studyflow.platforms.xuexitong.pacing import parse_video_status
        status = parse_video_status({
            "status": "success", "dtoken": "d", "duration": 600,
            "playTime": 30000, "isPassed": False,
        }, "o1")
        self.assertIsNotNone(status)
        self.assertEqual(status.play_time, 30)
        seconds = parse_video_status({
            "status": "success", "dtoken": "d", "duration": 600,
            "playTime": 30, "isPassed": True,
        }, "o1")
        self.assertEqual(seconds.play_time, 30)
        self.assertTrue(seconds.passed)
        self.assertIsNone(parse_video_status({"status": "failed"}, "o1"))

    def test_readonly_status_nonfinite_playtime_does_not_hang_or_false_confirm(self) -> None:
        from studyflow.platforms.xuexitong.pacing import parse_video_status
        for invalid in (float("inf"), float("-inf"), float("nan"),
                        "Infinity", "NaN", 10 ** 400, True):
            with self.subTest(invalid=repr(invalid)[:24]):
                status = parse_video_status({
                    "status": "success", "dtoken": "d", "duration": 600,
                    "playTime": invalid, "isPassed": False,
                }, "o1")
                self.assertIsNotNone(status)
                self.assertEqual(status.play_time, 0)
                self.assertFalse(status.passed)

    def test_readonly_status_rejects_invalid_duration(self) -> None:
        from studyflow.platforms.xuexitong.pacing import parse_video_status
        for invalid in (float("inf"), float("-inf"), float("nan"), True):
            with self.subTest(invalid=invalid):
                self.assertIsNone(parse_video_status({
                    "status": "success", "dtoken": "d", "duration": invalid,
                    "playTime": 20, "isPassed": True,
                }, "o1"))

    def test_readonly_http_status_nonfinite_is_unavailable(self) -> None:
        from studyflow.platforms.xuexitong.pacing import fetch_video_status
        for invalid in (float("inf"), float("nan"), "unverified"):
            with self.subTest(invalid=invalid):
                session = FakeSession([FakeResponse(
                    status=invalid, payload={"status": "success", "duration": 600}
                )])
                self.assertIsNone(fetch_video_status(session, "o1"))
                self.assertEqual(len(session.calls), 1)

    def test_calibrate_target_only_moves_forward(self) -> None:
        from studyflow.platforms.xuexitong.pacing import VideoStatus, calibrate_target
        target = make_target(initial_seconds=10)
        calibrated = calibrate_target(target, VideoStatus("object-001", "new-token", 600, 45, False))
        self.assertEqual(calibrated.dtoken, "new-token")
        self.assertEqual(calibrated.initial_seconds, 45)
        self.assertEqual(calibrate_target(target, VideoStatus("object-001", "", 600, 5, False)), target)

    def test_calibrate_clamps_offset_when_server_duration_shrinks(self) -> None:
        from studyflow.platforms.xuexitong.pacing import (
            VideoStatus, calibrate_target, reconcile_playing_time,
        )
        target = make_target(initial_seconds=590)
        status = VideoStatus(target.object_id, "new-token", 300, 20, False)
        calibrated = calibrate_target(target, status)
        self.assertEqual(calibrated.duration, 300)
        self.assertEqual(calibrated.initial_seconds, 300)
        calibrated.validate()
        self.assertEqual(reconcile_playing_time(590, status), 300)

    def test_status_public_dict_leaks_no_token(self) -> None:
        from studyflow.platforms.xuexitong.pacing import VideoStatus
        public = VideoStatus("o1", "secret-token", 600, 30, True).public_dict()
        self.assertNotIn("secret-token", repr(public))
        self.assertEqual(public["server_play_time"], 30)


class TestRunnerAuditFixes(unittest.TestCase):
    """审计整改：虚构完成包隔离、403 恢复、暂停计时、退出边界、队列取消。"""

    def test_settings_contract_is_the_default(self) -> None:
        config = RunConfig.from_settings(None)
        self.assertEqual(config.speed, 1.0)
        self.assertEqual(config.max_workers, 2)
        self.assertTrue(config.randomize_interval)
        self.assertTrue(config.skip_completed)
        self.assertTrue(config.verify_after_run)

    def test_completion_probe_does_not_pollute_local_progress(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": False}) for _ in range(12)])
        clock = FakeClock()
        config = RunConfig(instant_complete=True, heartbeat_interval_video_seconds=30,
                           tick_seconds=10, max_ticks=4, speed=1.0)
        runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                     config, clock=clock, sleeper=clock.sleep)
        runner.start()
        self.assertEqual(session.calls[0]["params"]["isdrag"], 4)
        self.assertEqual(session.calls[0]["params"]["playingTime"], 600)
        self.assertLess(session.calls[1]["params"]["playingTime"], 600)
        self.assertGreater(session.calls[1]["params"]["playingTime"], 0)

    def test_resume_checkpoint_is_clamped_after_duration_refresh(self) -> None:
        from studyflow.platforms.xuexitong.pacing import VideoStatus
        clock = FakeClock()
        session = FakeSession([FakeResponse(payload={"isPassed": False})])
        status = VideoStatus("object-001", "updated-token", 300, 20, False)
        config = RunConfig(
            instant_complete=False, heartbeat_interval_video_seconds=30,
            tick_seconds=1, max_ticks=1, status_provider=lambda _target: status,
        )
        runner = HeartbeatTaskRunner(
            make_target(initial_seconds=590), make_sender(session, clock=clock),
            config, clock=clock, sleeper=clock.sleep, resume_playing_time=590,
        )
        snapshot = runner.start()
        self.assertEqual(snapshot.duration, 300)
        self.assertLessEqual(snapshot.playing_time, snapshot.duration)
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(session.calls[0]["params"]["playingTime"], 300)

    def test_forbidden_refreshes_token_before_retry(self) -> None:
        from studyflow.platforms.xuexitong.pacing import VideoStatus
        events: list[str] = []
        session = FakeSession(
            [FakeResponse(status=403, text="forbidden"),
             FakeResponse(payload={"isPassed": False})]
            + [FakeResponse(payload={"isPassed": False}) for _ in range(8)]
        )
        clock = FakeClock()
        calls = {"n": 0}

        def provider(target):
            calls["n"] += 1
            if calls["n"] < 2:
                return None  # 启动前校准不可用，确保刷新确实由 403 触发
            return VideoStatus(target.object_id, "refreshed-token", 600, 45, False)

        config = RunConfig(instant_complete=True, heartbeat_interval_video_seconds=30,
                           tick_seconds=10, max_ticks=4, speed=1.0,
                           status_provider=provider)
        runner = HeartbeatTaskRunner(
            make_target(), make_sender(session, clock=clock), config,
            clock=clock, sleeper=clock.sleep,
            on_event=lambda name, _payload: events.append(name),
        )
        runner.start()
        self.assertIn("heartbeat.recovered", events)
        self.assertNotIn("refreshed-token", session.calls[0]["url"])
        self.assertIn("refreshed-token", session.calls[1]["url"])

    def test_paused_wall_time_is_excluded_from_timeout_budget(self) -> None:
        clock = FakeClock()
        config = RunConfig(instant_complete=False, tick_seconds=100, max_ticks=3,
                           max_wall_seconds=50, heartbeat_interval_video_seconds=30)

        def resume_after_two_waits(seconds: float) -> None:
            clock.sleep(seconds)
            if clock.t >= 1200.0:
                runner._paused.clear()

        runner = HeartbeatTaskRunner(make_target(), make_sender(FakeSession([]), clock=clock),
                                     config, clock=clock, sleeper=resume_after_two_waits)
        runner._started = True
        runner._paused.set()
        self.assertTrue(runner._wait_while_paused())
        self.assertEqual(runner._paused_wall, 200.0)
        self.assertEqual(runner._ticks, 0, "pausing must not use active-tick limits")

    def test_unconfirmed_round_limit_ends_loop(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": False}) for _ in range(20)])
        clock = FakeClock()
        config = RunConfig(instant_complete=False, heartbeat_interval_video_seconds=30,
                           tick_seconds=10, max_ticks=0, max_unconfirmed_rounds=2, speed=1.0)
        runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                     config, clock=clock, sleeper=clock.sleep)
        snapshot = runner.start()
        self.assertEqual(snapshot.state, TaskState.INTERRUPTED.value)
        self.assertEqual(snapshot.end_reason, "unconfirmed_limit")
        self.assertFalse(snapshot.confirmed)

    def test_stop_before_run_cancels_queued_chapters(self) -> None:
        session = FakeSession([])
        queue = ChapterQueue(make_sender(session), RunConfig(max_workers=1))
        self.assertTrue(queue.submit_chapter("c1", [make_target(object_id="v1", job_id="j1")]))
        queue.stop_all()
        self.assertEqual(queue.run(), {})
        self.assertEqual(session.calls, [])

    def test_server_record_corrects_local_terminal_state(self) -> None:
        from studyflow.platforms.xuexitong.pacing import VideoStatus
        counter = {"n": 0}

        def provider(target):
            counter["n"] += 1
            return VideoStatus(target.object_id, "d", target.duration, 0, counter["n"] >= 2)

        session = FakeSession([FakeResponse(payload={"isPassed": False}) for _ in range(8)])
        clock = FakeClock()
        config = RunConfig(instant_complete=False, max_ticks=2, tick_seconds=10,
                           heartbeat_interval_video_seconds=30,
                           status_provider=provider, verify_after_run=True,
                           skip_completed=True)
        runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                     config, clock=clock, sleeper=clock.sleep)
        snapshot = runner.start()
        self.assertEqual(snapshot.state, TaskState.SUCCEEDED.value)
        self.assertTrue(snapshot.server_confirmed)

    def test_readonly_provider_error_is_unverified_and_does_not_abort_runner(self) -> None:
        clock = FakeClock()
        events = []
        calls = []

        def unavailable(target):
            calls.append(target.object_id)
            raise OSError("credential-bearing upstream URL must not reach UI")

        config = RunConfig(
            instant_complete=False, max_ticks=1, tick_seconds=1,
            heartbeat_interval_video_seconds=30, status_provider=unavailable,
            verify_after_run=True,
        )
        session = FakeSession()
        runner = HeartbeatTaskRunner(
            make_target(), make_sender(session, clock=clock),
            config, clock=clock, sleeper=clock.sleep,
            on_event=lambda name, value: events.append((name, value)),
        )
        snapshot = runner.start()
        self.assertEqual(snapshot.state, TaskState.INTERRUPTED.value)
        self.assertFalse(snapshot.server_confirmed)
        self.assertFalse(snapshot.confirmed)
        self.assertEqual(calls, ["object-001", "object-001"])
        event_names = [name for name, _ in events]
        self.assertIn("heartbeat.calibration_unavailable", event_names)
        self.assertIn("heartbeat.verification_unavailable", event_names)
        self.assertIn("task.finished", event_names)
        self.assertNotIn("credential-bearing", repr(events))
        self.assertEqual(session.calls, [])

    def test_malformed_readonly_status_cannot_claim_completion(self) -> None:
        clock = FakeClock()
        responses = [{"passed": True, "play_time": 600}, "passed", None]
        for returned in responses:
            with self.subTest(returned=returned):
                config = RunConfig(
                    instant_complete=False, max_ticks=1, tick_seconds=1,
                    heartbeat_interval_video_seconds=30,
                    status_provider=lambda _target: returned,
                    verify_after_run=True,
                )
                runner = HeartbeatTaskRunner(
                    make_target(), make_sender(FakeSession(), clock=clock),
                    config, clock=clock, sleeper=clock.sleep,
                )
                snapshot = runner.start()
                self.assertEqual(snapshot.state, TaskState.INTERRUPTED.value)
                self.assertFalse(snapshot.confirmed)
                self.assertFalse(snapshot.server_confirmed)

    def test_run_id_is_attached_to_snapshot(self) -> None:
        session = FakeSession([FakeResponse(payload={"isPassed": True})])
        clock = FakeClock()
        config = RunConfig(run_id="run-xyz", instant_complete=True, max_ticks=2)
        runner = HeartbeatTaskRunner(make_target(), make_sender(session, clock=clock),
                                     config, clock=clock, sleeper=clock.sleep)
        self.assertEqual(runner.start().run_id, "run-xyz")


class TestSidecarContractFixes(unittest.TestCase):
    def make_service(self, folder: str, targets: list, responses: list):
        from studyflow.platforms.xuexitong.service import XuexitongHeartbeatService
        session = FakeSession(responses)
        return XuexitongHeartbeatService(
            os.path.join(folder, "state.json"),
            session_factory=lambda: session,
            targets_provider=lambda _key: targets,
            clock=FakeClock(),
            sleeper=lambda _seconds: None,
        )

    def test_run_id_contract_and_status_scope(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            targets = [make_target(object_id="v1", job_id="j1")]
            service = self.make_service(
                folder, targets,
                [FakeResponse(payload={"isPassed": True}) for _ in range(3)],
            )
            started = service.handle("xuexitong.heartbeat.start", {
                "course_key": "100001:200002:300003",
                "instant_complete": True,  # Synthetic test clock never advances.
            })
            self.assertTrue(started["ok"])
            run_id = started["run_id"]
            self.assertTrue(run_id)
            mismatch = service.handle("xuexitong.heartbeat.pause", {"run_id": "deadbeef"})
            self.assertEqual(mismatch["error"], "XUEXITONG_RUN_ID_MISMATCH")
            self.assertTrue(service.wait(5))

            service.store.save(TaskSnapshot(
                task_id="foreign-task", run_id="other-run",
                course_key="100001:200002:300003",
                state="running", sent_count=99,
            ))
            status = service.handle("xuexitong.heartbeat.status")
            self.assertEqual(status["heartbeats"]["sent"], 1)
            self.assertTrue(all(task["run_id"] == run_id for task in status["tasks"]))
            self.assertEqual(status["run_id"], run_id)

    def test_ui_settings_are_mapped_into_run_config(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            service = self.make_service(folder, [], [])
            started = service.handle("xuexitong.heartbeat.start", {
                "course_key": "100001:200002:300003",
                "settings": {
                    "playback_speed": 1.75, "concurrency": 3,
                    "skip_completed": False, "verify_after_run": False,
                },
            })
            self.assertTrue(started["ok"])
            self.assertEqual(started["speed"], 1.75)
            self.assertEqual(started["jobs"], 3)
            self.assertTrue(service.wait(5))


if __name__ == "__main__":
    unittest.main(verbosity=2)
