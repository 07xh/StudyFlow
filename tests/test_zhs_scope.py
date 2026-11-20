"""Offline scoped traversal tests do not issue heartbeat or HTTP requests."""
from copy import deepcopy
import sys
from types import ModuleType, SimpleNamespace

import pytest
from studyflow.platforms.zhidao.zhs_scope import (
    scoped_upstream_play, ScopeLimitReached, ScopeUnconfirmed, ScopeInvalid,
)


def test_shared_scope_limits_selected_unfinished_video_ids(monkeypatch):
    module = ModuleType("zhs.zhidao.video")
    errors = ModuleType("zhs.exceptions")
    class CaptchaRequired(Exception): pass
    class TimeLimitExceeded(Exception): pass
    errors.CaptchaRequired, errors.TimeLimitExceeded = CaptchaRequired, TimeLimitExceeded
    called = []
    class Player:
        def play_course(self, _, ctx):
            for ch in ctx.chapters:
                for lesson in ch.video_lessons:
                    for item in lesson.video_small_lessons:
                        self.play_video("", item.video_id, ctx)
        def play_video(self, _, identifier, ctx):
            called.append(identifier)
    module.ZhidaoVideoPlayer = Player
    monkeypatch.setitem(sys.modules, "zhs.zhidao.video", module)
    monkeypatch.setitem(sys.modules, "zhs.exceptions", errors)
    class Context:
        def __init__(self):
            self.videos = {i: SimpleNamespace(video_id=i, watch_state=(1 if i == 2 else 0))
                           for i in range(1, 6)}
            self.chapters = [SimpleNamespace(video_lessons=[
                SimpleNamespace(video_small_lessons=list(self.videos.values()))])]
        def model_copy(self, deep):
            return deepcopy(self)
    options={"selected_ids":[1,2,3,4],"scope_mode":"selected","max_videos":2,"stop_on_error":False}
    with pytest.raises(ScopeLimitReached):
        with scoped_upstream_play(options,False):
            Player().play_course("",Context())
    assert called==[1,3]
    with pytest.raises(ScopeInvalid):
        with scoped_upstream_play({**options,"selected_ids":[999]},False):
            Player().play_course("",Context())


def test_ai_incomplete_resource_at_local_threshold_is_unconfirmed(monkeypatch):
    course_mod, video_mod = ModuleType("zhs.ai.course"), ModuleType("zhs.ai.video")
    called = []
    class Manager:
        def _iter_targets(self, _):
            return iter([SimpleNamespace(knowledge=SimpleNamespace(knowledge_id=10))])
        def _process_resource(self, *_args, **_kwargs):
            called.append(True)
    class Player:
        def play_video(self, *args, **kwargs):
            called.append(True)
    course_mod.AiCourseManager, video_mod.AiVideoPlayer = Manager, Player
    monkeypatch.setitem(sys.modules, "zhs.ai.course", course_mod)
    monkeypatch.setitem(sys.modules, "zhs.ai.video", video_mod)
    opts = {"scope_mode":"selected","selected_ids":[10],"max_videos":0,
            "stop_on_error":True,"resource_mode":"video"}
    resource = SimpleNamespace(study_status=0, schedule=90, resources_detail=SimpleNamespace(
        resources_uid=25, resources_type=1, resources_distribute_type=3, resources_sync_type=1))
    with scoped_upstream_play(opts, True, target_resource=(10,25)):
        with pytest.raises(ScopeUnconfirmed):
            Manager()._process_resource(1,2,10,resource,Player(),[],False,90)
    assert not called, "No-op at threshold must not be shown as successful playback"


def test_ai_knowledge_scope_and_video_count(monkeypatch):
    course_mod,video_mod=ModuleType("zhs.ai.course"),ModuleType("zhs.ai.video")
    class Manager:
        def _iter_targets(self,_info):
            return iter([SimpleNamespace(knowledge=SimpleNamespace(knowledge_id=i))
                         for i in (1,2,3)])
    class Player:
        def play_video(self,*args,**kwargs):
            return None
    course_mod.AiCourseManager,video_mod.AiVideoPlayer=Manager,Player
    monkeypatch.setitem(sys.modules,"zhs.ai.course",course_mod)
    monkeypatch.setitem(sys.modules,"zhs.ai.video",video_mod)
    opts={"scope_mode":"selected","selected_ids":[2],"max_videos":1,"stop_on_error":True}
    with scoped_upstream_play(opts,True):
        assert [t.knowledge.knowledge_id for t in Manager()._iter_targets(None)]==[2]
        with pytest.raises(ScopeLimitReached):
            Player().play_video(schedule=0,threshold=90)
    assert [t.knowledge.knowledge_id for t in Manager()._iter_targets(None)]==[1,2,3]

def test_ai_resource_selection_is_enforced_inside_upstream_scope(monkeypatch):
    course_mod, video_mod = ModuleType("zhs.ai.course"), ModuleType("zhs.ai.video")
    seen = []
    class Manager:
        def _iter_targets(self, _info):
            return iter([SimpleNamespace(knowledge=SimpleNamespace(knowledge_id=12))])
        def _process_resource(self, _cid, _cls, _kid, item, *args, **kwargs):
            seen.append(item.resources_detail.resources_uid)
    class Player:
        def play_video(self, *args, **kwargs):
            return None
    course_mod.AiCourseManager, video_mod.AiVideoPlayer = Manager, Player
    monkeypatch.setitem(sys.modules, "zhs.ai.course", course_mod)
    monkeypatch.setitem(sys.modules, "zhs.ai.video", video_mod)
    def resource(uid, kind):
        return SimpleNamespace(study_status=0,
            resources_detail=SimpleNamespace(resources_uid=uid,
                resources_type=1, resources_distribute_type=3,
                resources_sync_type=kind))
    for mode, expected in [("required",[21]),("optional",[22]),("both",[21,22])]:
        seen.clear()
        options = {"scope_mode":"selected","selected_ids":[12], "max_videos":0,
                   "stop_on_error":False, "resource_mode":"all",
                   "learn_optional":mode!="required", "requirement_mode":mode}
        with scoped_upstream_play(options, True):
            for row in [resource(21,1),resource(22,2)]:
                Manager()._process_resource(1,2,12,row,Player(),[],mode!="required",100)
        assert seen == expected, mode
