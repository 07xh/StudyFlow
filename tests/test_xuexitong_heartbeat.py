"""本地心跳模块离线验证：全部使用注入的假 session / 假时钟，不发真实请求。

运行：
    python -m unittest discover -s tests -p "test_xuexitong_heartbeat.py" -v
"""
from __future__ import annotations

import hashlib
import os
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
        for bad in (dict(speed=0.5), dict(speed=2.5),
                    dict(heartbeat_interval_video_seconds=10),
                    dict(heartbeat_interval_video_seconds=120),
                    dict(max_workers=0), dict(dtype="Slides")):
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
        values = dict(max_ticks=6, tick_seconds=0.01,
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
            started = service.handle("xuexitong.heartbeat.start", {"course_key": "1:2:3"})
            self.assertTrue(started["ok"])
            pause = service.handle("xuexitong.heartbeat.pause", {})
            logs = service.handle("xuexitong.heartbeat.logs", {})
            names = [entry["event"] for entry in logs["events"]]
            self.assertIn("service.pause", names)
            self.assertTrue(pause["ok"] or pause["error"] == "XUEXITONG_NO_ACTIVE_TASK")
            service.handle("xuexitong.heartbeat.resume", {})
            self.assertTrue(service.wait(5), "后台队列未在 5s 内结束")


if __name__ == "__main__":
    unittest.main(verbosity=2)
