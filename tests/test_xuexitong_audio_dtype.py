"""视频 / 音频 dtype 分流的离线验证：假 session、假时钟，不发真实请求。

运行：
    python -m unittest discover -s tests -p "test_xuexitong_audio_dtype.py" -v
"""
from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from studyflow.platforms.xuexitong.heartbeat import (  # noqa: E402
    AUDIO_HEADERS,
    VIDEO_HEADERS,
    HeartbeatResult,
    SendState,
    VideoTarget,
    build_packet,
)
from studyflow.platforms.xuexitong.runner import HeartbeatTaskRunner, RunConfig  # noqa: E402
from studyflow.platforms.xuexitong.service import XuexitongHeartbeatService  # noqa: E402


def _load_adapter():
    """adapter 顶层依赖 requests / bs4；离线测试只给最小占位，不改业务代码。"""
    injected = []
    for name in ("requests", "bs4"):
        if name not in sys.modules:
            module = types.ModuleType(name)
            if name == "bs4":
                module.BeautifulSoup = object
            else:
                module.Session = object
            sys.modules[name] = module
            injected.append(name)
    try:
        from studyflow.platforms.xuexitong import adapter
        return adapter
    finally:
        for name in injected:
            sys.modules.pop(name, None)


adapter = _load_adapter()


class Ticker:
    def __init__(self, start: float = 1000.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


class TextResponse:
    def __init__(self, text: str, status: int = 200) -> None:
        self.text = text
        self.status_code = status
        self.is_redirect = False

    def json(self):
        return json.loads(self.text)


class CardSession:
    def __init__(self, cards_text: str) -> None:
        self.cookies = {"fid": "1024"}
        self.cards_text = cards_text
        self.card_calls = 0

    def close(self) -> None:
        return None

    def get(self, url: str, **kwargs):
        if url == adapter.CARDS_URL:
            self.card_calls += 1
            return TextResponse(self.cards_text if self.card_calls == 1 else "<html></html>")
        return TextResponse('{"status":"success","dtoken":"tok","duration":120}')


class ConfirmedSession:
    def get(self, url: str, **kwargs):
        return TextResponse('{"isPassed": true}')


class CapturingSender:
    def __init__(self) -> None:
        self.packets = []

    def send(self, packet, *, attempts: int = 1) -> HeartbeatResult:
        self.packets.append(packet)
        return HeartbeatResult(
            state=SendState.CONFIRMED,
            sent=True,
            server_confirmed=True,
            http_status=200,
            task_id=packet.task_id,
            playing_time=packet.playing_time,
            duration=packet.duration,
            sent_at=0.0,
        )

    def send_with_rt_fallback(self, target, playing_time, **kwargs):
        return self.send(build_packet(target, playing_time, **kwargs))


def make_task(**overrides):
    values = dict(
        course_key="100001:200002:300003", chapter_id="9001", chapter="第一章",
        title="任务", clazz_id="200002", course_id="100001", cpi="300003",
        job_id="job-001", object_id="object-001", other_info="nodeId_9001",
        duration=600, initial_seconds=0, dtoken="tok", rt=0.9,
    )
    values.update(overrides)
    return adapter.VideoTask(**values)


def make_target(**overrides) -> VideoTarget:
    values = dict(
        course_key="100001:200002:300003", chapter_id="9001", chapter="第一章",
        title="任务", clazz_id="200002", course_id="100001", cpi="300003",
        job_id="job-001", object_id="object-001", other_info="nodeId_9001",
        duration=600, initial_seconds=0, dtoken="tok", rt=0.9,
        userid="12345678", fid="1024",
    )
    values.update(overrides)
    return VideoTarget(**values)


def cards_text() -> str:
    payload = {"attachments": [
        {"type": "video", "objectId": "obj-v", "jobid": "job-v",
         "otherInfo": "nodeId_9001", "property": {"name": "视频任务", "rt": 0.9}},
        {"type": "audio", "objectId": "obj-a", "jobid": "job-a",
         "otherInfo": "nodeId_9001", "property": {"name": "音频任务", "rt": 0.9}},
    ]}
    return "window.mArg = " + json.dumps(payload, ensure_ascii=False) + ";"


CHAPTERS = [{"id": "9001", "title": "第一章", "completed": False, "locked": False}]


class TestAdapterMediaSplit(unittest.TestCase):
    def test_video_task_dtype_defaults_to_video(self):
        self.assertEqual(make_task().dtype, "Video")
        self.assertEqual(make_task(dtype="Audio").dtype, "Audio")

    def test_list_video_tasks_returns_both_video_and_audio(self):
        session = CardSession(cards_text())
        with patch.object(adapter.XuexitongAdapter, "list_chapters", return_value=CHAPTERS), \
             patch.object(adapter, "_session", return_value=session):
            tasks = adapter.XuexitongAdapter().list_video_tasks("100001:200002:300003")
        self.assertEqual(len(tasks), 2)
        self.assertEqual({task.dtype for task in tasks}, {"Video", "Audio"})
        audio = [task for task in tasks if task.dtype == "Audio"][0]
        self.assertEqual(audio.object_id, "obj-a")
        self.assertEqual(audio.duration, 120)

    def test_target_inherits_dtype_from_adapter_task(self):
        target = VideoTarget.from_adapter_task(make_task(dtype="Audio"), userid="12345678")
        self.assertEqual(target.dtype, "Audio")
        self.assertEqual(
            VideoTarget.from_adapter_task(make_task(), userid="12345678").dtype, "Video"
        )


class TestPacketDtype(unittest.TestCase):
    def test_audio_packet_uses_audio_headers(self):
        packet = build_packet(make_target(), 60, dtype="Audio")
        self.assertEqual(packet.params["dtype"], "Audio")
        self.assertEqual(packet.headers, AUDIO_HEADERS)
        self.assertNotEqual(packet.headers, VIDEO_HEADERS)

    def test_video_packet_uses_video_headers(self):
        packet = build_packet(make_target(), 60)
        self.assertEqual(packet.params["dtype"], "Video")
        self.assertEqual(packet.headers, VIDEO_HEADERS)

    def test_target_rejects_unknown_dtype(self):
        with self.assertRaises(ValueError):
            make_target(dtype="Slides").validate()


class TestRunnerUsesTargetDtype(unittest.TestCase):
    def test_config_dtype_does_not_override_audio_target(self):
        sender = CapturingSender()
        clock = Ticker()
        runner = HeartbeatTaskRunner(
            make_target(dtype="Audio"), sender,
            RunConfig(dtype="Video", instant_complete=True, max_ticks=1, run_id="run-audio"),
            clock=clock, sleeper=clock.sleep,
        )
        runner.start()
        self.assertEqual(len(sender.packets), 1)
        self.assertEqual(sender.packets[0].dtype, "Audio")
        self.assertEqual(sender.packets[0].headers, AUDIO_HEADERS)


class TestServiceDtypeFilter(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.state_path = str(Path(self._tmp.name) / "state.json")

    def tearDown(self):
        self._tmp.cleanup()

    def _service(self, targets):
        clock = Ticker()
        return XuexitongHeartbeatService(
            self.state_path,
            clock=clock, sleeper=clock.sleep,
            session_factory=lambda: ConfirmedSession(),
            targets_provider=lambda _key: list(targets),
            status_provider=lambda _target: None,
        )

    def test_audio_filter_runs_only_audio_target(self):
        service = self._service([
            make_target(object_id="obj-v", job_id="job-v", dtype="Video"),
            make_target(object_id="obj-a", job_id="job-a", dtype="Audio"),
        ])
        result = service.handle("xuexitong.heartbeat.start", {
            "course_key": "100001:200002:300003", "dtype": "Audio", "max_ticks": 1,
        })
        self.assertTrue(result["ok"])
        self.assertEqual(result["task_count"], 1)
        service.handle("xuexitong.heartbeat.stop", {})
        self.assertTrue(service.wait(3.0))

    def test_no_target_for_selected_dtype_is_public_error(self):
        service = self._service([make_target(dtype="Video")])
        result = service.handle("xuexitong.heartbeat.start", {
            "course_key": "100001:200002:300003", "dtype": "Audio",
        })
        self.assertEqual(result, {"ok": False, "error": "XUEXITONG_NO_TARGET_FOR_DTYPE"})

    def test_without_filter_both_targets_run(self):
        service = self._service([
            make_target(object_id="obj-v", job_id="job-v", dtype="Video"),
            make_target(object_id="obj-a", job_id="job-a", dtype="Audio"),
        ])
        result = service.handle("xuexitong.heartbeat.start", {
            "course_key": "100001:200002:300003", "max_ticks": 1,
        })
        self.assertTrue(result["ok"])
        self.assertEqual(result["task_count"], 2)
        service.handle("xuexitong.heartbeat.stop", {})
        self.assertTrue(service.wait(3.0))


if __name__ == "__main__":
    unittest.main(verbosity=2)
