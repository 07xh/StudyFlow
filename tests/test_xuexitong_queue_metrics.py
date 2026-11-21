"""Read-only queue metrics regression tests; no network requests or playback."""
from __future__ import annotations

import tempfile
import unittest
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from studyflow.platforms.xuexitong.heartbeat import VideoTarget
from studyflow.platforms.xuexitong.runner import ChapterQueue, HeartbeatTaskRunner, RunConfig
from studyflow.platforms.xuexitong.service import XuexitongHeartbeatService


COURSE = "course:class:cpi"


def target(chapter: str, item: str) -> VideoTarget:
    return VideoTarget(
        course_key=COURSE, chapter_id=chapter, chapter="第" + chapter + "章",
        title="任务" + item, clazz_id="class", course_id="course", cpi="cpi",
        job_id="job" + item, object_id="object" + item, other_info="nodeId_1-rt_1",
        duration=600, initial_seconds=0, dtoken="secret", userid="test-user",
    )


class ThreadStub:
    def __init__(self) -> None:
        self.alive = True

    def is_alive(self) -> bool:
        return self.alive


class TestQueueMetrics(unittest.TestCase):
    def setUp(self) -> None:
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.config = RunConfig(run_id="test-run", max_workers=2, instant_complete=False)
        self.queue = ChapterQueue(object(), self.config)
        self.first = target("1", "a")
        self.second = target("1", "b")
        self.third = target("2", "c")
        self.queue.submit_chapter("1", [self.first, self.second])
        self.queue.submit_chapter("2", [self.third])
        self.service = XuexitongHeartbeatService(
            str(Path(self.folder.name) / "state.json"),
            session_factory=lambda: object(),
        )
        self.thread = ThreadStub()
        self.service._queue = self.queue
        self.service._thread = self.thread
        self.service._config = self.config
        self.service._course_key = COURSE
        self.service._run_id = "test-run"
        self.service._account_marker = ""

    def test_queued_tasks_visible_before_any_runner_starts(self) -> None:
        result = self.service.status(COURSE)
        self.assertEqual(result["task_count"], 3)
        self.assertEqual(result["queue"]["total_chapters"], 2)
        self.assertEqual(result["queue"]["queued_chapters"], 2)
        self.assertEqual(result["queue"]["active_chapters"], 0)
        self.assertEqual(result["queue"]["pending_tasks"], 3)
        self.assertTrue(all(item["state"] == "pending" for item in result["tasks"]))

    def test_active_chapter_counts_unique_chapter_not_configured_workers(self) -> None:
        runner = HeartbeatTaskRunner(self.first, object(), self.config)
        runner._snapshot.state = "running"  # Observe a runner; do not start network work.
        runner._runtime_playing_time = 240.8  # UI-only clock sample.
        self.queue._runners[self.first.task_id] = runner
        result = self.service.status(COURSE)
        live = next(item for item in result["tasks"] if item["task_id"] == self.first.task_id)
        self.assertEqual(live["playing_time"], 240)
        self.assertEqual(runner.snapshot.playing_time, 0,
                         "Live display must not mutate the persisted task state")
        self.assertEqual(result["queue"]["active_chapters"], 1)
        self.assertEqual(result["queue"]["queued_chapters"], 1)
        self.assertEqual(result["queue"]["running_tasks"], 1)
        self.assertEqual(result["queue"]["pending_tasks"], 2)
        self.assertEqual(result["task_count"], 3)
        self.assertTrue(all(item["chapter_id"] for item in result["tasks"]))
        public = str(result["tasks"])
        self.assertNotIn("secret", public)
        self.assertNotIn("other_info", public)

    def test_terminated_queue_does_not_claim_running_or_queued(self) -> None:
        runner = HeartbeatTaskRunner(self.first, object(), self.config)
        runner._snapshot.state = "running"
        self.queue._runners[self.first.task_id] = runner
        self.thread.alive = False
        result = self.service.status(COURSE)
        self.assertEqual(result["queue"]["active_chapters"], 0)
        self.assertEqual(result["queue"]["queued_chapters"], 0)
        self.assertEqual(result["queue"]["pending_tasks"], 0)
        states = {item["task_id"]: item["state"] for item in result["tasks"]}
        self.assertEqual(states[self.first.task_id], "interrupted")
        self.assertEqual(states[self.second.task_id], "not_started")

    def test_duplicate_task_identity_is_only_scheduled_once(self) -> None:
        from dataclasses import replace

        queue = ChapterQueue(object(), self.config)
        another_job = replace(self.first, job_id="job-other")
        self.assertTrue(queue.submit_chapter("1", [
            self.first, self.first, another_job, self.second, self.second,
        ]))
        # Provider data from another chapter must not re-enqueue the same ID.
        self.assertTrue(queue.submit_chapter("2", [self.first, self.third, self.third]))
        self.assertFalse(queue.submit_chapter("1", [self.first]))
        self.assertEqual(queue.task_count, 4)
        snapshots = queue.status_snapshots(running=True)
        self.assertEqual(len(snapshots), 4)
        self.assertEqual(len({item.task_id for item in snapshots}), 4)
        self.assertTrue(all(item.state == "pending" for item in snapshots))

    def test_other_course_has_no_live_queue_or_private_tasks(self) -> None:
        result = self.service.status("elsewhere")
        self.assertIsNone(result["queue"])
        self.assertEqual(result["tasks"], [])
        self.assertEqual(result["run_id"], "")


if __name__ == "__main__":
    unittest.main()
