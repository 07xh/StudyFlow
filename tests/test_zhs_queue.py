"""Queue tests use local child processes only; no school service requests."""
import json
import subprocess
import sys
import time
from types import SimpleNamespace as NS

import pytest
from studyflow.platforms.zhidao import zhs_settings


def test_concurrency_settings_migrate_existing_preferences(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert zhs_settings.read_settings()["concurrency"] == 2
    old = {k: v for k, v in zhs_settings.DEFAULTS.items() if k != "concurrency"}
    path = tmp_path / "StudyFlow/zhidao/zhs-task-settings.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(old))
    assert zhs_settings.read_settings()["concurrency"] == 1
    for bad in (0, 4, True, 1.5):
        with pytest.raises(ValueError):
            zhs_settings.validate_settings({**zhs_settings.DEFAULTS, "concurrency": bad})


@pytest.mark.parametrize("stored,want_concurrency,want_threshold", [
    ({},1,None), ({"completion_threshold":85},1,85), ({"concurrency":3},3,None),
    ({"concurrency":2,"completion_threshold":90},2,90),
])
def test_both_feature_settings_migrate_without_losing_course_preferences(tmp_path,monkeypatch,stored,want_concurrency,want_threshold):
    monkeypatch.setenv("LOCALAPPDATA",str(tmp_path))
    path = tmp_path / "StudyFlow/zhidao/zhs-task-settings.json"
    path.parent.mkdir(parents=True)
    base = {k:v for k,v in zhs_settings.DEFAULTS.items() if k not in ("concurrency","completion_threshold")}
    path.write_text(json.dumps({**base,**stored}))
    value = zhs_settings.read_settings()
    assert value["concurrency"] == want_concurrency
    assert value["completion_threshold"] == want_threshold


def test_pre_threshold_run_settings_keep_automatic_target():
    old = {k:v for k,v in zhs_settings.DEFAULTS.items() if k != "completion_threshold"}
    value = zhs_settings.validate_run_settings({**old,"scope_mode":"all","selected_ids":[]})
    assert value["completion_threshold"] is None
    assert value["concurrency"] == 2


def test_catalog_deduplicates_exact_resources_and_respects_global_video_limit():
    from studyflow.services.zhs_queue import resource_targets, limit_targets
    def resource(uid, kind=(1, 3), done=False, optional=False):
        return NS(study_status=int(done), resources_detail=NS(
            resources_uid=uid, resources_type=kind[0], resources_distribute_type=kind[1],
            resources_name=f"资源 {uid}", resources_sync_type=2 if optional else 1))
    options = {**zhs_settings.DEFAULTS, "scope_mode": "all", "selected_ids": [], "resource_mode": "all"}
    rows = resource_targets(10, [resource(1), resource(1), resource(2), resource(3, done=True),
                                resource(4, optional=True), resource(5, (1, 4))], options)
    assert [(x.knowledge_id, x.resource_id, x.kind) for x in rows] == [
        (10, 1, "video"), (10, 2, "video"), (10, 5, "ppt")]
    limited, truncated = limit_targets(rows, 1)
    assert [x.resource_id for x in limited] == [1]
    assert truncated is True


def test_exact_ai_target_never_runs_sibling_video_or_reading(monkeypatch):
    import sys
    from types import ModuleType
    from studyflow.platforms.zhidao.zhs_scope import scoped_upstream_play
    course, video = ModuleType("zhs.ai.course"), ModuleType("zhs.ai.video")
    called = []
    class Manager:
        def _iter_targets(self, _):
            return iter([NS(knowledge=NS(knowledge_id=10))])
        def _process_resource(self, cid, cls, kid, item, *args, **kwargs):
            called.append(item.resources_detail.resources_uid)
    class Player:
        def play_video(self, *args, **kwargs): pass
    course.AiCourseManager, video.AiVideoPlayer = Manager, Player
    monkeypatch.setitem(sys.modules, "zhs.ai.course", course)
    monkeypatch.setitem(sys.modules, "zhs.ai.video", video)
    opts = {**zhs_settings.DEFAULTS, "scope_mode":"selected", "selected_ids":[10], "resource_mode":"video"}
    with scoped_upstream_play(opts, True, target_resource=(10, 22)):
        for uid in (21, 22, 23):
            Manager()._process_resource(1, 2, 10, NS(study_status=0, resources_detail=NS(
                resources_uid=uid, resources_type=1, resources_distribute_type=3)))
    assert called == [22]


def test_real_process_queue_overlaps_refills_and_isolates_failure(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    targets = [QueueTarget(i, None, "video", f"视频{i}") for i in (1, 2, 3)]
    launched = []
    script = "import time,sys,pathlib; p=pathlib.Path(sys.argv[1]); p.write_text(str(time.time())); time.sleep(.25); sys.exit(int(sys.argv[2]))"
    def launch(target, token):
        launched.append(target.resource_id)
        return subprocess.Popen([sys.executable, "-c", script, str(tmp_path / f"start{target.resource_id}"),
                                 "7" if target.resource_id == 1 else "0"], stdin=subprocess.PIPE)
    assert supervise(targets, 2, "a" * 32, tmp_path, launch) == 13
    starts = [float((tmp_path / f"start{i}").read_text()) for i in (1, 2, 3)]
    assert abs(starts[0] - starts[1]) < .2
    assert starts[2] - min(starts[:2]) >= .2
    assert launched == [1, 2, 3]
    data = json.loads((tmp_path / ("zhs-queue-" + "a" * 32 + ".json")).read_text())
    assert [row["state"] for row in data["tasks"]] == ["failed", "exited", "exited"]
    assert data["state"] == "exited"


def test_stop_one_worker_refills_without_stopping_others(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    import threading
    targets = [QueueTarget(i, None, "video", None) for i in (1, 2, 3)]
    children = []
    def launch(target, token):
        child = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(.5)"], stdin=subprocess.PIPE)
        children.append(child)
        if target.resource_id == 2:
            (tmp_path / f"zhs-stop-{'b'*32}-{targets[0].task_id}").write_text(targets[0].task_id)
        return child
    assert supervise(targets, 2, "b" * 32, tmp_path, launch) == 0
    data = json.loads((tmp_path / f"zhs-queue-{'b'*32}.json").read_text())
    assert [row["state"] for row in data["tasks"]] == ["stopped", "exited", "exited"]
    assert all(child.poll() is not None for child in children)


def test_same_chapter_order_and_stop_on_error_cleanup(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    targets = [QueueTarget(i, 10, kind, None, "ai-1", "第一章")
               for i, kind in ((1,"video"),(2,"ppt"),(3,"video"))]
    children = []
    def launch(target, token):
        assert all(child.poll() is not None for child in children)
        child = subprocess.Popen([sys.executable,"-c","import time,sys;time.sleep(.05);sys.exit(int(sys.argv[1]))",
                                  "4" if target.resource_id == 2 else "0"], stdin=subprocess.PIPE)
        children.append(child)
        return child
    assert supervise(targets, 2, "c" * 32, tmp_path, launch, stop_on_error=True) == 13
    assert len(children) == 2
    assert all(child.poll() is not None for child in children)



def test_distinct_chapters_overlap_but_video_ppt_article_keep_chapter_order(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    # A chapter's PPT stays behind its first video, but doesn't block the
    # independent second chapter's video, or its subsequent article.
    targets = [
        QueueTarget(1, 11, "video", "1.1", "ai-1", "第一章"),
        QueueTarget(2, 11, "ppt", "1.2", "ai-1", "第一章"),
        QueueTarget(3, 21, "video", "2.1", "ai-2", "第二章"),
        QueueTarget(4, 21, "article", "2.2", "ai-2", "第二章"),
    ]
    observed, processes = [], []
    def launch(target, token):
        active = [group for child, group in processes if child.poll() is None]
        assert target.chapter_key not in active, "chapter resource order was broken"
        observed.append((target.resource_id, frozenset(active)))
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(.30)"],
            stdin=subprocess.PIPE)
        processes.append((child, target.chapter_key))
        return child

    assert supervise(targets, 2, "8" * 32, tmp_path, launch) == 0
    ids = [item_id for item_id, _ in observed]
    assert ids.index(1) < ids.index(2)
    assert ids.index(3) < ids.index(4)
    assert any(active and (item_id in (1, 3)) for item_id, active in observed), (
        "two distinct chapter lanes never overlapped")
    assert len(processes) == 4
    snapshot = json.loads((tmp_path / f"zhs-queue-{'8'*32}.json").read_text())
    assert [row["chapter_key"] for row in snapshot["tasks"]] == [
        "ai-1", "ai-1", "ai-2", "ai-2"]
    assert all(row["state"] == "exited" for row in snapshot["tasks"])


def test_one_chapter_uses_one_lane_even_if_concurrency_is_three(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    targets = [QueueTarget(i, 10, kind, None, "ai-1", "第一章")
               for i, kind in ((1, "video"), (2, "article"), (3, "ppt"))]
    children = []
    def launch(target, token):
        assert all(child.poll() is not None for child in children)
        child = subprocess.Popen(
            [sys.executable, "-c", "import time;time.sleep(.08)"],
            stdin=subprocess.PIPE)
        children.append(child)
        return child
    assert supervise(targets, 3, "9" * 32, tmp_path, launch) == 0
    assert len(children) == 3


def test_catalog_chapter_metadata_is_server_backed(monkeypatch):
    from types import ModuleType
    from studyflow.services.zhs_queue import discover_targets
    bootstrap = ModuleType("zhs.cli.bootstrap")
    ai_course = ModuleType("zhs.ai.course")
    shared_course = ModuleType("zhs.zhidao.course")
    session = NS(close=lambda: None)
    bootstrap.load_config_and_session = lambda **kwargs: (None, session)
    monkeypatch.setitem(sys.modules, "zhs.cli.bootstrap", bootstrap)
    monkeypatch.setitem(sys.modules, "zhs.ai.course", ai_course)
    monkeypatch.setitem(sys.modules, "zhs.zhidao.course", shared_course)
    def resource(uid):
        return NS(study_status=0, resources_detail=NS(
            resources_uid=uid, resources_type=1, resources_distribute_type=3,
            resources_name=f"视频 {uid}", resources_sync_type=1))
    class AI:
        def __init__(self, session): pass
        def get_knowledge_points(self, cid, cls):
            return NS(cake_theme_list=[
                NS(theme_name="第一章", knowledge_list=[NS(knowledge_id=11, study_progress=0)]),
                NS(theme_name="第二章", knowledge_list=[NS(knowledge_id=21, study_progress=0)]),
            ])
        def list_knowledge_resources(self, cid, cls, kid):
            return [resource(kid)]
    ai_course.AiCourseManager = AI
    options = {**zhs_settings.DEFAULTS, "scope_mode":"all","selected_ids":[],"resource_mode":"all"}
    ai_targets, _ = discover_targets({"courseType":"ai","courseId":1,"classId":2}, options)
    assert [(t.chapter_key, t.chapter_name) for t in ai_targets] == [
        ("ai-1", "第一章"), ("ai-2", "第二章")]
    class Shared:
        def __init__(self, session): pass
        def get_context(self, route, force):
            a, b = NS(video_id=31, name="第三章 3.1", watch_state=0), NS(
                video_id=41, name="第四章 4.1", watch_state=0)
            return NS(videos={31:a, 41:b}, chapters=[
                NS(name="第三章", video_lessons=[NS(video_small_lessons=[a])]),
                NS(name="第四章", video_lessons=[NS(video_small_lessons=[b])]),
            ])
    shared_course.ZhidaoCourseManager = Shared
    shared_targets, _ = discover_targets(
        {"courseType":"shared","recruitAndCourseId":"route"}, options)
    assert [(t.chapter_key, t.chapter_name) for t in shared_targets] == [
        ("shared-1", "第三章"), ("shared-2", "第四章")]


def test_launch_exception_cleans_up_started_process(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    children = []
    def launch(target, token):
        if target.resource_id == 2:
            raise OSError("cannot spawn")
        child = subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"], stdin=subprocess.PIPE)
        children.append(child)
        return child
    assert supervise([QueueTarget(i,None,"video",None) for i in (1,2,3)],2,"d"*32,tmp_path,launch,
                     stop_on_error=True) == 13
    assert len(children) == 1
    assert children[0].poll() is not None


def test_public_worker_routes_parallel_options_to_supervisor(monkeypatch, tmp_path):
    from studyflow.services import legacy_playback as legacy, zhs_queue
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    calls = []
    monkeypatch.setattr(zhs_queue, "run_queue", lambda *args: calls.append(args) or 12)
    opts = {**zhs_settings.DEFAULTS, "scope_mode":"all", "selected_ids":[], "resource_mode":"video"}
    assert legacy.main(["--legacy-zhidao", "a"*64, "b"*32, json.dumps(opts)]) == 12
    assert calls == [("a"*64, "b"*32, opts)]


def test_child_parent_watchdog_exits_when_owner_pipe_closes():
    script = ("from studyflow.services.zhs_queue import watch_parent_pipe; "
              "import time; watch_parent_pipe(); time.sleep(30)")
    child = subprocess.Popen([sys.executable, "-c", script], stdin=subprocess.PIPE)
    try:
        assert child.poll() is None
        child.stdin.close()
        assert child.wait(timeout=3) == 15
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()


def test_worker_can_exit_normally_while_parent_still_owns_stdin():
    script = ("from studyflow.services.zhs_queue import watch_parent_pipe; "
              "import time; watch_parent_pipe(); time.sleep(.1)")
    child = subprocess.Popen([sys.executable,"-c",script],stdin=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        assert child.wait(timeout=5) == 0
    finally:
        child.stdin.close()
        if child.poll() is None:
            child.kill();child.wait()


def test_malformed_stop_file_does_not_end_entire_queue(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    target = QueueTarget(1, None, "video", "第一讲")
    (tmp_path / f"zhs-stop-{'e'*32}-{target.task_id}").write_bytes(b"\xff" * 32)
    def launch(target, token):
        return subprocess.Popen([sys.executable,"-c","pass"], stdin=subprocess.PIPE)
    assert supervise([target],2,"e"*32,tmp_path,launch) == 0


def test_stale_and_foreign_child_telemetry_cannot_supply_live_percentage(tmp_path):
    from studyflow.services.zhs_queue import local_percent
    path = tmp_path / f"monitor-zhs-{'a'*32}.json"
    base = {"v":1,"token":"a"*32,"at":time.time(),"videoSegmentPercent":48.5}
    path.write_text(json.dumps(base))
    assert local_percent(tmp_path,"a"*32) == 48.5
    for altered in ({"token":"b"*32},{"at":time.time()-19},{"videoSegmentPercent":float('nan')}):
        path.write_text(json.dumps({**base,**altered}))
        assert local_percent(tmp_path,"a"*32) is None


def test_shared_child_failure_is_not_swallowed_by_original_course_loop(monkeypatch, tmp_path):
    from studyflow.services import zhs_queue
    captured = []
    monkeypatch.setenv("LOCALAPPDATA",str(tmp_path))
    class Child:
        stdin = None
        def poll(self): return 0
    monkeypatch.setattr(zhs_queue,"discover_targets",lambda *args:([zhs_queue.QueueTarget(1,None,"video",None)],False))
    from studyflow.services import legacy_playback
    monkeypatch.setattr(legacy_playback,"_current_course_row",lambda _: {"courseType":"shared"})
    monkeypatch.setattr(zhs_queue.subprocess,"Popen",lambda command,**kwargs: captured.append(command) or Child())
    opts = {**zhs_settings.DEFAULTS,"scope_mode":"all","selected_ids":[],"resource_mode":"video", "completion_threshold":85}
    assert zhs_queue.run_queue("a"*64,"b"*32,opts) == 0
    child_options = json.loads(captured[0][-2])
    assert child_options["stop_on_error"] is True
    assert child_options["completion_threshold"] == 85


@pytest.mark.parametrize("fatal_class", ["CaptchaRequired", "TimeLimitExceeded"])
def test_shared_fatal_condition_escapes_upstream_normal_return(monkeypatch, fatal_class):
    from types import ModuleType
    from studyflow.platforms.zhidao.zhs_scope import scoped_upstream_play, ScopeFailed
    errors = ModuleType("zhs.exceptions")
    errors.CaptchaRequired, errors.TimeLimitExceeded = type("CaptchaRequired",(Exception,),{}),type("TimeLimitExceeded",(Exception,),{})
    module = ModuleType("zhs.zhidao.video")
    class Player:
        def play_course(self, route, context):
            try: self.play_video(route,1,context)
            except (errors.CaptchaRequired, errors.TimeLimitExceeded): return None
        def play_video(self, *args): raise getattr(errors,fatal_class)()
    module.ZhidaoVideoPlayer = Player
    monkeypatch.setitem(sys.modules,"zhs.exceptions",errors)
    monkeypatch.setitem(sys.modules,"zhs.zhidao.video",module)
    options = {**zhs_settings.DEFAULTS,"scope_mode":"selected","selected_ids":[1],"resource_mode":"video"}
    with scoped_upstream_play(options,False,target_resource=(None,1)):
        with pytest.raises(ScopeFailed): Player().play_video("",1,NS(videos={}))


def test_fatal_child_diagnostic_halts_queue_even_when_generic_errors_continue(tmp_path,monkeypatch):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    monkeypatch.setenv("LOCALAPPDATA",str(tmp_path))
    directory = tmp_path / "StudyFlow"
    children = []
    def launch(target, token):
        script = "import json,sys,time,pathlib;pathlib.Path(sys.argv[1]).write_text(json.dumps({'v':1,'token':sys.argv[2],'at':time.time(),'code':'CAPTCHA_REQUIRED'}));sys.exit(13)"
        child = subprocess.Popen([sys.executable,"-c",script,str(directory/f"zhs-diagnostic-{token}.json"),token],stdin=subprocess.PIPE)
        children.append(child)
        return child
    assert supervise([QueueTarget(i,None,"video",None) for i in (1,2,3)],2,"f"*32,directory,launch) == 13
    assert len(children) == 2
    assert all(child.poll() is not None for child in children)
    data = json.loads((directory/f"zhs-diagnostic-{'f'*32}.json").read_text())
    assert data["code"] == "CAPTCHA_REQUIRED"


def test_exited_rows_clear_their_last_local_percentage(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    def launch(target, token):
        script = "import json,sys,time,pathlib;pathlib.Path(sys.argv[1]).write_text(json.dumps({'v':1,'token':sys.argv[2],'at':time.time(),'videoSegmentPercent':48.5}));time.sleep(.05)"
        return subprocess.Popen([sys.executable,"-c",script,str(tmp_path/f"monitor-zhs-{token}.json"),token],stdin=subprocess.PIPE)
    assert supervise([QueueTarget(1,None,"video",None)],2,"e"*32,tmp_path,launch) == 0
    row = json.loads((tmp_path/f"zhs-queue-{'e'*32}.json").read_text())["tasks"][0]
    assert row["state"] == "exited"
    assert row["percent"] is None
    assert row["stale"] is True
