"""Read-only ZHS resource identity telemetry; no network or heartbeat calls."""
from __future__ import annotations

import json
import runpy
from pathlib import Path
from types import SimpleNamespace
import sys
from types import ModuleType

import pytest

from studyflow.platforms.zhidao.zhs_scope import scoped_upstream_play, ScopeInvalid
from studyflow.services.zhs_resource_monitor import create_resource_monitor, safe_resource_title

VENDOR = Path(__file__).resolve().parents[1] / "legacy" / "zhidao" / "ZHS-ConsoleMonitor.py"


def test_real_resource_name_and_type_stay_bounded_and_video_percent_resets(tmp_path):
    original = runpy.run_path(str(VENDOR), run_name="studyflow_test_resource")
    sink = create_resource_monitor(original["NumericTelemetry"], "a" * 32, tmp_path)
    sink.receive("处理资源 5/6")
    sink.mark_resource("video", "第 3 讲：电路分析")
    sink.receive("playing [===] 48.0%")
    data = json.loads(sink.path.read_text(encoding="utf-8"))
    assert data["resourceKind"] == "video"
    assert data["resourceName"] == "第 3 讲：电路分析"
    assert data["videoSegmentPercent"] == 48.0
    assert (data["resourceIndex"], data["resourceTotal"]) == (5, 6)

    sink.mark_resource("ppt", "第 4 讲 PPT")
    data = json.loads(sink.path.read_text(encoding="utf-8"))
    assert data["resourceKind"] == "ppt"
    assert data["resourceName"] == "第 4 讲 PPT"
    assert data["videoSegmentPercent"] is None
    assert set(data) == {"v", "token", "videoSegmentPercent", "resourceIndex",
                         "resourceTotal", "resourceKind", "resourceName", "playbackPhase", "at"}


def test_resource_metadata_sanitization_never_persists_untrusted_urls_or_tokens(tmp_path):
    original = runpy.run_path(str(VENDOR), run_name="studyflow_test_resource_private")
    sink = create_resource_monitor(original["NumericTelemetry"], "b" * 32, tmp_path)
    for private in ("Cookie=TOPSECRET", "https://example.test/secret", "student@example.test",
                    "Authorization: token x", "T" * 91):
        assert safe_resource_title(private) is None
        sink.mark_resource("article", private)
        data = json.loads(sink.path.read_text(encoding="utf-8"))
        assert data["resourceKind"] == "article"
        assert data["resourceName"] is None
        assert private not in json.dumps(data)


def test_ai_resources_are_filtered_without_changing_original_processing(monkeypatch):
    course_mod, video_mod = ModuleType("zhs.ai.course"), ModuleType("zhs.ai.video")
    called = []
    class Manager:
        def _iter_targets(self, info):
            return iter([])
        def _process_resource(self, course_id, class_id, knowledge_id, item, *args, **kwargs):
            called.append(item.resources_detail.resources_name)
            return "original-result"
    class Player:
        def play_video(self, *args, **kwargs):
            return None
    course_mod.AiCourseManager, video_mod.AiVideoPlayer = Manager, Player
    monkeypatch.setitem(sys.modules, "zhs.ai.course", course_mod)
    monkeypatch.setitem(sys.modules, "zhs.ai.video", video_mod)

    def item(kind, title):
        return SimpleNamespace(resources_detail=SimpleNamespace(
            resources_type=kind[0], resources_distribute_type=kind[1], resources_name=title
        ))
    resources = [
        item((1,3), "视频 A"), item((2,2), "课程视频 B"),
        item((1,4), "PPT C"), item((2,1), "文章 D"),
        item((3,5), "其他 E"),
    ]
    original = Manager._process_resource
    opts = {"scope_mode":"all", "selected_ids":[], "max_videos":0,
            "stop_on_error":False, "resource_mode":"video"}
    observed = []
    with scoped_upstream_play(opts, True, on_resource=lambda kind,name: observed.append((kind,name))):
        for resource in resources:
            Manager()._process_resource(1,2,3,resource)
    assert called == ["视频 A", "课程视频 B"]
    assert observed == [("video", "视频 A"), ("video", "课程视频 B")]
    assert Manager._process_resource is original

    called.clear(); observed.clear()
    with scoped_upstream_play({**opts, "resource_mode":"reading"}, True,
                              on_resource=lambda kind,name: observed.append((kind,name))):
        for resource in resources:
            Manager()._process_resource(1,2,3,resource)
    assert called == ["PPT C", "文章 D"]
    assert observed == [("ppt", "PPT C"), ("article", "文章 D")]
    assert Manager._process_resource is original

    with pytest.raises(ScopeInvalid):
        with scoped_upstream_play({**opts, "resource_mode":"reading"}, False):
            pass


def test_only_scheduled_ai_resources_are_marked_active(monkeypatch):
    course_mod, video_mod = ModuleType("zhs.ai.course"), ModuleType("zhs.ai.video")
    calls = []
    class Manager:
        def _iter_targets(self, _info):
            return iter([])
        def _process_resource(self, _course, _class, _knowledge, item, *args, **kwargs):
            calls.append(item)
            return None
    class Player:
        def play_video(self, *args, **kwargs):
            return None
    course_mod.AiCourseManager, video_mod.AiVideoPlayer = Manager, Player
    monkeypatch.setitem(sys.modules, "zhs.ai.course", course_mod)
    monkeypatch.setitem(sys.modules, "zhs.ai.video", video_mod)
    def item(status, sync):
        return SimpleNamespace(
            study_status=status,
            resources_detail=SimpleNamespace(
                resources_type=1, resources_distribute_type=3,
                resources_name="课程视频", resources_sync_type=sync
            ),
        )
    shown = []
    options = {"scope_mode": "all", "selected_ids": [], "max_videos": 0,
               "stop_on_error": False, "resource_mode": "all"}
    with scoped_upstream_play(options, True, on_resource=lambda kind,name: shown.append((kind,name))):
        for resource in (item(1,1), item(0,2), item(0,1)):
            Manager()._process_resource(1,2,3,resource)
    assert len(calls) == 3  # Original method retains its own completion/optional rules.
    assert shown == [("video", "课程视频")]


def test_shared_video_title_from_server_context_does_not_change_original_call(monkeypatch):
    module = ModuleType("zhs.zhidao.video")
    errors = ModuleType("zhs.exceptions")
    class CaptchaRequired(Exception): pass
    class TimeLimitExceeded(Exception): pass
    errors.CaptchaRequired = CaptchaRequired
    errors.TimeLimitExceeded = TimeLimitExceeded
    calls = []
    class Player:
        def play_course(self, rac_id, ctx):
            return self.play_video(rac_id, 123, ctx)
        def play_video(self, rac_id, video_id, ctx):
            calls.append((rac_id, video_id, ctx))
            return "kept"
    module.ZhidaoVideoPlayer = Player
    monkeypatch.setitem(sys.modules, "zhs.zhidao.video", module)
    monkeypatch.setitem(sys.modules, "zhs.exceptions", errors)
    original = Player.play_video
    context = SimpleNamespace(
        videos={123: SimpleNamespace(video_id=123, name="第一章 电路", watch_state=0)}
    )
    opts = {"scope_mode": "all", "selected_ids": [], "max_videos": 0,
            "stop_on_error": False, "resource_mode": "video"}
    observed = []
    with scoped_upstream_play(opts, False, on_resource=lambda kind,title: observed.append((kind,title))):
        assert Player().play_video("course", 123, context) == "kept"
    assert observed == [("video", "第一章 电路")]
    assert calls == [("course", 123, context)]
    assert Player.play_video is original


def test_failed_resource_observer_cannot_interrupt_original_shared_play(monkeypatch):
    module = ModuleType("zhs.zhidao.video")
    errors = ModuleType("zhs.exceptions")
    class CaptchaRequired(Exception): pass
    class TimeLimitExceeded(Exception): pass
    errors.CaptchaRequired = CaptchaRequired
    errors.TimeLimitExceeded = TimeLimitExceeded
    class Player:
        def play_course(self, rac_id, ctx):
            return None
        def play_video(self, rac_id, video_id, ctx):
            return 42
    module.ZhidaoVideoPlayer = Player
    monkeypatch.setitem(sys.modules, "zhs.zhidao.video", module)
    monkeypatch.setitem(sys.modules, "zhs.exceptions", errors)
    opts = {"scope_mode": "all", "selected_ids": [], "max_videos": 0,
            "stop_on_error": False, "resource_mode": "all"}
    def broken_observer(*_):
        raise OSError("test monitor unavailable")
    with scoped_upstream_play(opts, False, on_resource=broken_observer):
        assert Player().play_video("course", 1, SimpleNamespace(
            videos={1: SimpleNamespace(name="title", watch_state=0)}
        )) == 42
