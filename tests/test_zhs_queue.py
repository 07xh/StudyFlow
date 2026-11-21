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


def test_local_observation_handles_legacy_frames_and_rejects_fake_phase(tmp_path, monkeypatch):
    from studyflow.services.zhs_queue import local_observation, local_percent
    from studyflow.services import zhs_queue

    token = "d" * 32
    sample_path = tmp_path / f"monitor-zhs-{token}.json"
    clock = [100.0]
    monkeypatch.setattr(zhs_queue.time, "time", lambda: clock[0])
    snapshot = {"v": 1, "token": token, "at": 100.0,
                "videoSegmentPercent": 11.5}
    sample_path.write_text(json.dumps(snapshot))
    assert local_observation(tmp_path, token) == (11.5, None)
    assert local_percent(tmp_path, token) == 11.5

    snapshot["playbackPhase"] = "paused"
    sample_path.write_text(json.dumps(snapshot))
    assert local_observation(tmp_path, token) == (None, None)
    snapshot["videoSegmentPercent"] = None
    sample_path.write_text(json.dumps(snapshot))
    assert local_observation(tmp_path, token) == (None, "paused")
    clock[0] = 120.0
    assert local_observation(tmp_path, token) == (None, None)
    snapshot["at"] = 120.0
    snapshot["playbackPhase"] = "unrecognized"
    sample_path.write_text(json.dumps(snapshot))
    assert local_observation(tmp_path, token) == (None, None)


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


def test_sampling_freshness_is_video_only_and_never_invents_a_percentage():
    from studyflow.services.zhs_queue import sampling_is_stale
    for kind in ("ppt", "article", "other"):
        assert not sampling_is_stale(kind, None, had_sample=False, running_seconds=120)
        assert not sampling_is_stale(kind, None, had_sample=True, running_seconds=120)
    assert not sampling_is_stale("video", None, had_sample=False, running_seconds=24.9)
    assert sampling_is_stale("video", None, had_sample=False, running_seconds=25)
    assert sampling_is_stale("video", None, had_sample=True, running_seconds=1)
    assert not sampling_is_stale("video", 37.5, had_sample=True, running_seconds=120)


def test_two_real_child_processes_report_independent_live_video_samples(tmp_path, monkeypatch):
    """Both running chapters must have separate numeric telemetry, not only lane one."""
    from studyflow.services import zhs_queue

    snapshots = []
    write = zhs_queue.atomic_json

    def collect(path, data):
        if path.name.startswith("zhs-queue-"):
            snapshots.append(json.loads(json.dumps(data)))
        write(path, data)

    monkeypatch.setattr(zhs_queue, "atomic_json", collect)
    targets = [
        zhs_queue.QueueTarget(1, None, "video", "3.5", "shared-3", "第三章"),
        zhs_queue.QueueTarget(2, None, "video", "4.6", "shared-4", "第四章"),
    ]
    script = (
        "import json,pathlib,sys,time;"
        "p=pathlib.Path(sys.argv[1]);"
        "p.write_text(json.dumps({'v':1,'token':sys.argv[2],"
        "'at':time.time(),'videoSegmentPercent':float(sys.argv[3])}));"
        "time.sleep(.95)"
    )

    def launch(target, token):
        return subprocess.Popen(
            [sys.executable, "-c", script,
             str(tmp_path / f"monitor-zhs-{token}.json"), token,
             "24.5" if target.resource_id == 1 else "76.5"],
            stdin=subprocess.PIPE,
        )

    assert zhs_queue.supervise(targets, 2, "7" * 32, tmp_path, launch) == 0
    paired = [data["tasks"] for data in snapshots
              if len(data["tasks"]) == 2 and all(
                  row["state"] == "running" and not row["stale"]
                  for row in data["tasks"]
              ) and [row["percent"] for row in data["tasks"]] == [24.5, 76.5]]
    assert paired, "both independent live samples must coexist in a queue snapshot"
    final = json.loads((tmp_path / ("zhs-queue-" + "7" * 32 + ".json")).read_text())
    assert [row["state"] for row in final["tasks"]] == ["exited", "exited"]
    assert all(row["percent"] is None for row in final["tasks"])


def test_running_ppt_does_not_report_unavailable_video_sampling(tmp_path, monkeypatch):
    from studyflow.services import zhs_queue
    snapshots = []
    atomic_json = zhs_queue.atomic_json

    def capture(path, data):
        if path.name.startswith("zhs-queue-"):
            snapshots.append(json.loads(json.dumps(data)))
        atomic_json(path, data)

    monkeypatch.setattr(zhs_queue, "atomic_json", capture)
    target = zhs_queue.QueueTarget(1, 10, "ppt", "阅读", "ai-1", "第一章")

    def launch(target, token):
        return subprocess.Popen([sys.executable, "-c", "import time;time.sleep(.25)"],
                                stdin=subprocess.PIPE)

    assert zhs_queue.supervise([target], 1, "d" * 32, tmp_path, launch) == 0
    active = [entry["tasks"][0] for entry in snapshots
              if entry["tasks"][0]["state"] == "running"]
    assert active
    assert all(row["percent"] is None and row["stale"] is False for row in active)


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


def test_queue_atomic_replace_retries_transient_windows_sharing_denial(tmp_path, monkeypatch):
    from studyflow.services import zhs_queue
    original = zhs_queue.os.replace
    attempts = []

    def temporarily_locked(src, dst):
        attempts.append((src, dst))
        if len(attempts) <= 2:
            raise PermissionError("transient Windows sharing violation")
        return original(src, dst)

    monkeypatch.setattr(zhs_queue.os, "replace", temporarily_locked)
    path = tmp_path / "queue.json"
    zhs_queue.atomic_json(path, {"state": "running", "percent": 35.0})
    assert len(attempts) == 3
    assert json.loads(path.read_text()) == {"state": "running", "percent": 35.0}


def test_queue_snapshots_keep_state_transitions_immediate_but_throttle_numeric_updates(tmp_path, monkeypatch):
    from studyflow.services import zhs_queue
    captured = []
    original = zhs_queue.atomic_json

    def observe(path, data):
        if path.name.startswith("zhs-queue-"):
            captured.append((time.monotonic(), json.loads(json.dumps(data))))
        original(path, data)

    monkeypatch.setattr(zhs_queue, "atomic_json", observe)
    target = zhs_queue.QueueTarget(10, None, "video", "视频", "shared-1", "第一章")

    def launch(target, token):
        code = (
            "import json,pathlib,sys,time;"
            "p=pathlib.Path(sys.argv[1]);"
            "p.write_text(json.dumps({'v':1,'token':sys.argv[2],'at':time.time(),"
            "'videoSegmentPercent':45.0}));"
            "time.sleep(.85)"
        )
        return subprocess.Popen(
            [sys.executable, "-c", code,
             str(tmp_path / f"monitor-zhs-{token}.json"), token],
            stdin=subprocess.PIPE,
        )

    assert zhs_queue.supervise([target], 1, "3"*32, tmp_path, launch) == 0
    assert any(row["tasks"][0]["state"] == "running" for _, row in captured)
    assert captured[0][1]["tasks"][0]["state"] == "queued"
    assert captured[-1][1]["state"] == "exited"
    assert len(captured) <= 6, "large queue payload must not be rewritten every 100 ms"


def test_tauri_owned_zhidao_main_installs_parent_liveness_watcher_before_lock(monkeypatch):
    from studyflow.services import legacy_playback as legacy, zhs_queue
    monkeypatch.setenv("STUDYFLOW_WATCH_PARENT_PIPE", "1")
    calls = []
    monkeypatch.setattr(zhs_queue, "watch_parent_pipe", lambda: calls.append("parent-pipe"))
    monkeypatch.setattr(legacy, "_run_exclusive",
                        lambda platform, callback: calls.append("exclusive") or 10)
    options = {**zhs_settings.DEFAULTS, "scope_mode": "all",
               "selected_ids": [], "resource_mode": "video"}
    assert legacy.main(["--legacy-zhidao", "a"*64, "b"*32, json.dumps(options)]) == 10
    assert calls == ["parent-pipe", "exclusive"]

    def unavailable():
        raise ValueError("missing parent-owned pipe")

    monkeypatch.setattr(zhs_queue, "watch_parent_pipe", unavailable)
    calls.clear()
    assert legacy.main(["--legacy-zhidao", "a"*64, "b"*32, json.dumps(options)]) == 15
    assert calls == []


def test_windows_launcher_owns_parent_pipe_without_disabling_job_object():
    from pathlib import Path
    rust = (Path(__file__).resolve().parents[1] / "src-tauri/src/legacy_tasks.rs").read_text()
    assert 'command.env("STUDYFLOW_WATCH_PARENT_PIPE", "1")' in rust
    assert "command.stdin(Stdio::piped())" in rust
    assert "let process_job = WindowsJob::attach(&child)" in rust



def test_worker_oserror_inside_acquired_lock_is_not_misclassified_as_lock_error(monkeypatch):
    from contextlib import contextmanager
    from studyflow.services import legacy_playback as legacy

    calls = []

    @contextmanager
    def lock(platform):
        calls.append("acquire")
        try:
            yield
        finally:
            calls.append("release")

    monkeypatch.setattr(legacy, "_exclusive_worker", lock)

    def playback():
        calls.append("started")
        raise OSError("simulated task I/O interruption")

    with pytest.raises(OSError, match="task I/O"):
        legacy._run_exclusive("zhidao", playback)
    assert calls == ["acquire", "started", "release"]


def test_lock_acquisition_retries_only_before_task_starts(monkeypatch):
    from contextlib import contextmanager
    from studyflow.services import legacy_playback as legacy

    attempts, calls = [], []

    @contextmanager
    def acquire(platform):
        attempts.append(platform)
        if len(attempts) <= 2:
            raise PermissionError("sharing violation")
        yield

    monkeypatch.setattr(legacy, "_exclusive_worker", acquire)
    monkeypatch.setattr(legacy.time, "sleep", lambda _: None)
    assert legacy._run_exclusive("zhidao", lambda: calls.append("run") or 0) == 0
    assert len(attempts) == 3
    assert calls == ["run"], "an already-started task must never be replayed"


def test_single_and_three_lane_workers_continue_after_telemetry_disk_failures(monkeypatch, tmp_path):
    """A UI snapshot write error must not terminate legitimate worker processes."""
    from studyflow.services import zhs_queue
    original = zhs_queue.atomic_json

    for slots in (1, 3):
        token = str(slots) * 32
        attempts = [0]
        seen = []

        def flaky_snapshot(path, data):
            if path.name.startswith("zhs-queue-"):
                attempts[0] += 1
                if attempts[0] == 1:
                    raise PermissionError("temporary Windows file lock")
            return original(path, data)

        monkeypatch.setattr(zhs_queue, "atomic_json", flaky_snapshot)
        targets = [
            zhs_queue.QueueTarget(i, None, "video", f"视频 {i}", f"shared-{i}", f"章节 {i}")
            for i in range(1, slots + 1)
        ]

        def launch(target, child_token):
            seen.append(target.resource_id)
            return subprocess.Popen(
                [sys.executable, "-c", "import time;time.sleep(.1)"],
                stdin=subprocess.PIPE,
            )

        assert zhs_queue.supervise(targets, slots, token, tmp_path, launch) == 0
        assert seen == list(range(1, slots + 1))
        assert attempts[0] >= 2
        completed = json.loads((tmp_path / f"zhs-queue-{token}.json").read_text())
        assert completed["state"] == "exited"
        assert all(row["state"] == "exited" for row in completed["tasks"])


def test_persistent_queue_snapshot_error_never_cancels_video_workers(monkeypatch, tmp_path):
    from studyflow.services import zhs_queue

    def unavailable(*args, **kwargs):
        raise PermissionError("persistent telemetry directory lock")

    monkeypatch.setattr(zhs_queue, "atomic_json", unavailable)
    started = []

    def launch(target, child_token):
        started.append(target.resource_id)
        return subprocess.Popen(
            [sys.executable, "-c", "import time;time.sleep(.12)"],
            stdin=subprocess.PIPE,
        )

    targets = [
        zhs_queue.QueueTarget(i, None, "video", f"视频 {i}", f"shared-{i}")
        for i in range(1, 4)
    ]
    assert zhs_queue.supervise(targets, 3, "f" * 32, tmp_path, launch) == 0
    assert started == [1, 2, 3]

def test_required_optional_classification_with_unchanged_server_status():
    from studyflow.services.zhs_queue import resource_targets
    def resource(uid, sync_type, schedule):
        return NS(study_status=0, schedule=schedule, resources_detail=NS(
            resources_uid=uid, resources_type=1, resources_distribute_type=3,
            resources_name=f"资源 {uid}", resources_sync_type=sync_type))
    opts = {**zhs_settings.DEFAULTS, "learn_optional": True, "resource_mode": "all"}
    rows = resource_targets(10, [resource(1, 1, 90), resource(2, 2, 20)], opts)
    assert [(row.requirement, row.baseline_progress) for row in rows] == [
        ("required", 90), ("optional", 20)]
    excluded = resource_targets(10, [resource(1, 1, 90), resource(2, 2, 20)],
                                {**opts, "learn_optional": False})
    assert [row.resource_id for row in excluded] == [1]
    unknown = resource(3, 1, 0)
    unknown.resources_detail.model_fields_set = set()
    assert resource_targets(10, [unknown], opts)[0].requirement == "unknown"


def test_server_readback_distinguishes_unchanged_and_advanced_ai_resources(monkeypatch):
    from types import ModuleType
    from studyflow.services import legacy_playback
    from studyflow.services.zhs_queue import QueueTarget, verify_server_advancement
    state = {"schedule": 90, "study_status": 0}
    row = NS(resources_detail=NS(resources_uid=11))
    def fetch_rows(*_):
        row.schedule = state["schedule"]
        row.study_status = state["study_status"]
        return [row]
    session = NS(close=lambda: None)
    bootstrap = ModuleType("zhs.cli.bootstrap")
    bootstrap.load_config_and_session = lambda **_: (None, session)
    ai_course = ModuleType("zhs.ai.course")
    class Manager:
        def __init__(self, _): pass
        list_knowledge_resources = fetch_rows
    ai_course.AiCourseManager = Manager
    monkeypatch.setitem(sys.modules, "zhs.cli.bootstrap", bootstrap)
    monkeypatch.setitem(sys.modules, "zhs.ai.course", ai_course)
    monkeypatch.setattr(legacy_playback, "_current_course_row",
                        lambda _: {"courseType": "ai", "courseId": 1, "classId": 2})
    target = QueueTarget(11, 4, "video", "必学视频", requirement="required", baseline_progress=90)
    assert verify_server_advancement("course", target) == 16
    state["schedule"] = 91
    assert verify_server_advancement("course", target) == 0
    state["schedule"], state["study_status"] = 90, 1
    assert verify_server_advancement("course", target) == 0
    bootstrap.load_config_and_session = lambda **_: None
    assert verify_server_advancement("course", target) == 17


def test_server_readback_shared_course_uses_server_watched_seconds(monkeypatch):
    from types import ModuleType
    from studyflow.services import legacy_playback
    from studyflow.services.zhs_queue import QueueTarget, verify_server_advancement
    observed = NS(watch_state=0, study_total_time=12)
    session = NS(close=lambda: None)
    bootstrap = ModuleType("zhs.cli.bootstrap")
    bootstrap.load_config_and_session = lambda **_: (None, session)
    shared_course = ModuleType("zhs.zhidao.course")
    class Manager:
        def __init__(self, _): pass
        def get_context(self, *_, **__):
            return NS(videos={42: observed})
    shared_course.ZhidaoCourseManager = Manager
    monkeypatch.setitem(sys.modules, "zhs.cli.bootstrap", bootstrap)
    monkeypatch.setitem(sys.modules, "zhs.zhidao.course", shared_course)
    monkeypatch.setattr(legacy_playback, "_current_course_row",
                        lambda _: {"courseType": "shared", "courseId": 9, "recruitAndCourseId": "route"})
    target = QueueTarget(42, None, "video", "普通共享课", requirement="shared", baseline_progress=12)
    assert verify_server_advancement("course", target) == 16
    observed.study_total_time = 15
    assert verify_server_advancement("course", target) == 0
    observed.study_total_time, observed.watch_state = 12, 1
    assert verify_server_advancement("course", target) == 0

def test_server_unconfirmed_exit_is_distinct_from_failed_playback(tmp_path):
    from studyflow.services.zhs_queue import QueueTarget, supervise
    target = QueueTarget(5, 1, "video", "服务器未确认的视频", requirement="required")
    def launch(_target, _token):
        return subprocess.Popen([sys.executable, "-c", "import sys; sys.exit(16)"],
                                stdin=subprocess.PIPE)
    assert supervise([target], 1, "e" * 32, tmp_path, launch) == 13
    snapshot = json.loads((tmp_path / ("zhs-queue-" + "e" * 32 + ".json")).read_text(encoding="utf-8"))
    assert snapshot["tasks"][0]["state"] == "unconfirmed"
    assert snapshot["tasks"][0]["exit_code"] == 16
    assert snapshot["tasks"][0]["requirement"] == "required"

def test_three_requirement_modes_are_exclusive_and_backward_compatible():
    from studyflow.services.zhs_queue import resource_targets
    from studyflow.platforms.zhidao.zhs_settings import validate_run_settings
    def resource(uid, sync_type=1, explicit=True):
        detail = NS(resources_uid=uid, resources_name="课时",
                    resources_type=1, resources_distribute_type=3,
                    resources_sync_type=sync_type)
        if not explicit:
            detail.model_fields_set = set()
        return NS(study_status=0, schedule=10, resources_detail=detail)
    rows = [resource(11), resource(22, 2), resource(33, 1, False)]
    base = {**zhs_settings.DEFAULTS, "scope_mode": "all", "selected_ids": [],
            "resource_mode": "all"}
    expected = {"required": [11], "optional": [22], "both": [11, 22, 33]}
    for mode, ids in expected.items():
        opts = validate_run_settings({**base, "learn_optional":mode != "required",
                                      "requirement_mode":mode})
        assert opts["requirement_mode"] == mode
        assert [t.resource_id for t in resource_targets(10, rows, opts)] == ids
    # Existing persisted checkbox-only courses retain their former semantics.
    assert [t.resource_id for t in resource_targets(10, rows,
        validate_run_settings(base))] == [11, 33]
    assert [t.resource_id for t in resource_targets(10, rows,
        validate_run_settings({**base, "learn_optional":True}))] == [11, 22, 33]
    for mode, optional in [("optional",False), ("required",True), ("both",False)]:
        with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
            validate_run_settings({**base, "learn_optional":optional, "requirement_mode":mode})
    with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
        validate_run_settings({**base,"requirement_mode":"forged"})
    with pytest.raises(ValueError, match="INVALID_ZHS_SETTINGS"):
        validate_run_settings({**base,"custom_key":"untrusted"})


def test_detail_only_ai_point_is_discovered_but_never_sent_as_a_resource(tmp_path, monkeypatch):
    """A knowledge detail tab with an empty resource list is informational only."""
    from types import ModuleType
    import sys
    from studyflow.services.zhs_queue import discover_targets, supervise

    zhs = ModuleType("zhs")
    zhs.__path__ = []
    cli = ModuleType("zhs.cli")
    cli.__path__ = []
    ai = ModuleType("zhs.ai")
    ai.__path__ = []
    bootstrap = ModuleType("zhs.cli.bootstrap")
    course_module = ModuleType("zhs.ai.course")
    session = NS(close=lambda: None)
    bootstrap.load_config_and_session = lambda **_kwargs: (None, session)

    class Manager:
        progress = 0
        def __init__(self, _session): pass

        def get_knowledge_points(self, _cid, _cls):
            return NS(cake_theme_list=[NS(theme_name="绪论", knowledge_list=[
                NS(knowledge_id=87, knowledge_name="历任校首", study_progress=self.progress)])])

        def list_knowledge_resources(self, _cid, _cls, _kid):
            return []  # The mobile app's 资源 tab says 暂无资源.

    course_module.AiCourseManager = Manager
    for name, module in (
        ("zhs", zhs), ("zhs.cli", cli), ("zhs.ai", ai),
        ("zhs.cli.bootstrap", bootstrap), ("zhs.ai.course", course_module)
    ):
        monkeypatch.setitem(sys.modules, name, module)

    options = {**zhs_settings.DEFAULTS, "scope_mode": "all",
               "selected_ids": [], "resource_mode": "all"}
    targets, limited = discover_targets(
        {"courseType": "ai", "courseId": 1, "classId": 2}, options)
    assert limited is False
    assert len(targets) == 1
    assert targets[0].kind == "detail"
    assert targets[0].resource_id == 0  # No real resource UID exists.
    assert targets[0].knowledge_id == 87
    assert targets[0].name == "历任校首"

    def forbidden_launch(_target, _token):
        raise AssertionError("A detail-only point must not start any sender")

    token = "d" * 32
    assert supervise(targets, 2, token, tmp_path, forbidden_launch) == 18
    snapshot = json.loads((tmp_path / f"zhs-queue-{token}.json").read_text())
    assert snapshot["tasks"][0]["state"] == "informational"
    assert snapshot["tasks"][0]["percent"] is None
    assert snapshot["tasks"][0]["exit_code"] is None

    # On the uploaded recording the directory shows completed points,
    # even though mastery stays at 0%; those must not become fake jobs.
    Manager.progress = 100
    completed, _ = discover_targets(
        {"courseType": "ai", "courseId": 1, "classId": 2}, options)
    assert completed == []
    Manager.progress = 0

    # Video-only selection should not create a synthetic detail task.
    video_only, _ = discover_targets(
        {"courseType": "ai", "courseId": 1, "classId": 2},
        {**options, "resource_mode": "video"})
    assert video_only == []
