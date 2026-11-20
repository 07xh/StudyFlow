"""Course-local process scheduling; the bundled ZHS player owns all reporting."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from studyflow.services.zhs_resource_monitor import safe_resource_title
from studyflow.platforms.zhidao.zhs_scope import ScopeInvalid


@dataclass(frozen=True)
class QueueTarget:
    resource_id: int
    knowledge_id: int | None
    kind: str
    name: str | None
    chapter_key: str | None = None
    chapter_name: str | None = None
    requirement: str = "unknown"
    baseline_progress: int | None = None

    @property
    def task_id(self) -> str:
        return hashlib.sha256(f"{self.knowledge_id}:{self.resource_id}".encode()).hexdigest()[:32]


def resource_targets(knowledge_id: int, resources, options: dict, *,
                     chapter_key: str | None = None,
                     chapter_name: str | None = None) -> list[QueueTarget]:
    result, seen = [], set()
    requirement_mode = options.get("requirement_mode")
    for resource in resources:
        detail = resource.resources_detail
        if resource.study_status == 1:
            continue
        fields = getattr(detail, "model_fields_set", None)
        requirement = ("unknown" if fields is not None and "resources_sync_type" not in fields
                       else "required" if detail.resources_sync_type == 1 else "optional")
        # New explicit modes are strict; legacy clients keep their historical
        # behavior based on the upstream optional flag and model defaults.
        if requirement_mode is None:
            if detail.resources_sync_type != 1 and not options["learn_optional"]:
                continue
        elif requirement_mode != "both" and requirement != requirement_mode:
            continue
        kind = {(1, 3): "video", (2, 2): "video", (1, 4): "ppt", (2, 1): "article"}.get(
            (detail.resources_type, detail.resources_distribute_type), "other")
        mode = options.get("resource_mode", "all")
        if (mode == "video" and kind != "video") or (mode == "reading" and kind not in ("ppt", "article")):
            continue
        uid = detail.resources_uid
        if type(uid) is not int or uid <= 0 or uid > 2**63 - 1:
            raise ScopeInvalid()
        if uid not in seen:
            # The source classification is distinct from a local playback state.
            schedule = getattr(resource, "schedule", None)
            baseline = schedule if type(schedule) is int and 0 <= schedule <= 100 else None
            result.append(QueueTarget(uid, knowledge_id, kind, safe_resource_title(detail.resources_name),
                                      chapter_key, chapter_name, requirement, baseline))
            seen.add(uid)
    return result


def limit_targets(targets: list[QueueTarget], maximum: int) -> tuple[list[QueueTarget], bool]:
    if not maximum:
        return targets, False
    count = 0
    for index, target in enumerate(targets):
        count += target.kind == "video"
        if count == maximum:
            return targets[:index + 1], index + 1 < len(targets)
    return targets, False


def discover_targets(course: dict, options: dict) -> tuple[list[QueueTarget], bool]:
    """Read the live catalog, never infer video identities from UI percentages."""
    from zhs.cli.bootstrap import load_config_and_session
    loaded = load_config_and_session(debug=False, console_log=False, proxy=None)
    if loaded is None:
        raise RuntimeError("LOGIN_REQUIRED")
    _, session = loaded
    selected = set(options["selected_ids"])
    targets = []
    try:
        if course["courseType"] == "ai":
            from zhs.ai.course import AiCourseManager
            manager = AiCourseManager(session)
            cid, cls = int(course["courseId"]), int(course["classId"])
            info = manager.get_knowledge_points(cid, cls)
            # A cake theme is the chapter boundary. Keep the server's theme and
            # knowledge-point order, then process resources in their original order.
            points = {
                point.knowledge_id: (point, theme_index, safe_resource_title(theme.theme_name))
                for theme_index, theme in enumerate(info.cake_theme_list, 1)
                for point in theme.knowledge_list
            }
            if not selected.issubset(points):
                raise ScopeInvalid()
            for kid, (point, theme_index, chapter_name) in points.items():
                if (selected and kid not in selected) or point.study_progress >= 101:
                    continue
                targets.extend(resource_targets(
                    kid, manager.list_knowledge_resources(cid, cls, kid), options,
                    chapter_key=f"ai-{theme_index}", chapter_name=chapter_name))
        else:
            from zhs.zhidao.course import ZhidaoCourseManager
            manager = ZhidaoCourseManager(session)
            route = course.get("recruitAndCourseId")
            if not route:
                found = manager.find_course(int(course["courseId"]))
                if found is None:
                    raise ScopeInvalid()
                route = found.secret
            ctx = manager.get_context(route, force=True)
            if not selected.issubset(ctx.videos) or options.get("resource_mode") == "reading":
                raise ScopeInvalid()
            # Use actual chapter membership from the live ZHS catalog, not
            # numeric video titles (e.g. "1.8") or stale frontend percentages.
            chapters = {
                item.video_id: (f"shared-{index}", safe_resource_title(chapter.name))
                for index, chapter in enumerate(ctx.chapters, 1)
                for lesson in chapter.video_lessons
                for item in lesson.video_small_lessons
            }
            for video in ctx.videos.values():
                if (selected and video.video_id not in selected) or video.watch_state == 1:
                    continue
                # Missing membership uses a single fallback chapter: never
                # silently run two unclassified resources out of order.
                chapter_key, chapter_name = chapters.get(video.video_id, ("shared-unmapped", None))
                watched = getattr(video, "study_total_time", None)
                baseline = (int(watched) if type(watched) in (int, float)
                            and math.isfinite(watched) and watched >= 0 else None)
                targets.append(QueueTarget(
                    video.video_id, None, "video", safe_resource_title(video.name),
                    chapter_key, chapter_name, "shared", baseline))
    finally:
        session.close()
    # A duplicate model must never schedule a video twice.
    targets = list({target.task_id: target for target in targets}.values())
    if len(targets) > 10000:
        raise ScopeInvalid()
    return limit_targets(targets, options["max_videos"])


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".zhs-queue-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, separators=(",", ":"))
        # Windows may briefly deny replacing a file while the Rust status
        # reader has it open. Retry only the atomic rename, never the task.
        # Persistent failures still surface instead of reporting a fake state.
        for attempt in range(6):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(.02 * (attempt + 1))
    finally:
        Path(temporary).unlink(missing_ok=True)


def local_observation(directory: Path, token: str) -> tuple[float | None, str | None]:
    """Read only one worker's fresh, bounded console observation.

    The playback phase is not a percentage. Missing/expired/invalid samples
    are never replaced with local timers or values from other workers.
    """
    path = directory / f"monitor-zhs-{token}.json"
    try:
        if path.is_symlink() or path.stat().st_size > 2048:
            return None, None
        data = json.loads(path.read_text(encoding="utf-8"))
        at, value = data.get("at"), data.get("videoSegmentPercent")
        phase = data.get("playbackPhase")
        if (data.get("v") != 1 or data.get("token") != token
                or type(at) not in (int, float) or not math.isfinite(at)
                or not -10 <= time.time() - at <= 18
                or phase not in (None, "playing", "paused", "answering")):
            return None, None
        if value is None:
            return None, phase
        if (type(value) not in (float, int) or not math.isfinite(value)
                or not 0 <= value <= 100 or phase in ("paused", "answering")):
            return None, None
        return value, phase
    except (OSError, ValueError, TypeError):
        return None, None


def local_percent(directory: Path, token: str) -> float | None:
    """Compatibility for callers needing only valid numeric playback."""
    return local_observation(directory, token)[0]


def sampling_is_stale(kind: str, percent: float | None, *, had_sample: bool,
                      running_seconds: float) -> bool:
    """No numeric video sample is different from stale video telemetry.

    Articles/PPTs never require a video percentage. A newly started video
    gets a brief loading window; a formerly observed or long-unobserved video
    reports an unavailable local sample, never a fabricated percentage.
    """
    return (kind == "video" and percent is None
            and (had_sample or running_seconds >= 25.0))


def terminate(child: subprocess.Popen) -> None:
    if child.poll() is None:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW, check=False)
        else:
            child.terminate()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
    if child.stdin is not None:
        child.stdin.close()


def fatal_diagnostic(directory: Path, token: str) -> str | None:
    path = directory / f"zhs-diagnostic-{token}.json"
    try:
        if path.is_symlink() or path.stat().st_size > 512:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        at = data.get("at")
        code = data.get("code")
        if (data.get("v") == 1 and data.get("token") == token
                and type(at) in (float, int) and math.isfinite(at) and -10 <= time.time()-at <= 120
                and code in ("CAPTCHA_REQUIRED", "TIME_RESTRICTED", "LOGIN_REQUIRED", "INTERACTIVE_INPUT_REQUIRED",
                             "ZHS_SESSION_EXPIRED", "ZHS_COOKIE_RESTORE_FAILED")):
            return code
    except (OSError, ValueError, TypeError):
        pass
    return None


def supervise(targets: list[QueueTarget], concurrency: int, token: str, directory: Path,
              launch, *, stop_on_error: bool = False, limit_seconds: float = 0) -> int:
    """Bounded chapter lanes: sequential within each chapter, parallel across chapters."""
    directory.mkdir(parents=True, exist_ok=True)
    rows = [{"task_id": t.task_id, "name": t.name, "kind": t.kind,
             "chapter_key": t.chapter_key, "chapter_name": t.chapter_name,
             "requirement": t.requirement,
             "state": "queued", "percent": None, "playback_phase": None, "stale": False, "exit_code": None} for t in targets]
    running = {}  # row index -> (owned process, private telemetry nonce)
    started_at: dict[int, float] = {}
    had_sample: set[int] = set()
    deadline = time.monotonic() + limit_seconds if limit_seconds else None
    exit_code = 0
    fatal = None
    last_publish_at = 0.0
    last_failed_publish_at = -float("inf")
    last_states = None
    last_queue_state = None

    def publish(state, *, force=False):
        nonlocal last_publish_at, last_failed_publish_at, last_states, last_queue_state
        now = time.monotonic()
        # UI telemetry must never stop an otherwise valid video job. Throttle
        # recovery attempts when the filesystem remains temporarily blocked.
        if not force and now - last_failed_publish_at < 1.0:
            return
        # State transitions (start/stop/exit) are immediate. Numeric samples
        # refresh at most 2 Hz: avoid full 100+ row Windows file rewrites at
        # 10 Hz while preserving the UI's existing two-second poll cadence.
        states = tuple((row["state"], row["exit_code"]) for row in rows)
        if (not force and states == last_states and state == last_queue_state
                and now - last_publish_at < .5):
            return
        try:
            atomic_json(directory / f"zhs-queue-{token}.json", {
                "v": 1, "token": token, "at": time.time(), "state": state,
                "concurrency": concurrency, "tasks": rows,
            })
        except OSError:
            last_failed_publish_at = now
            # Leave the last-successful snapshot unchanged. A later polling
            # cycle can recover without replaying a playback request.
            return
        last_states, last_queue_state, last_publish_at = states, state, now

    def stop(index):
        if index in running:
            child, child_token = running.pop(index)
            terminate(child)
            for prefix in ("monitor-zhs-", "zhs-diagnostic-"):
                (directory / f"{prefix}{child_token}.json").unlink(missing_ok=True)
        rows[index].update(state="stopped", percent=None, playback_phase=None, stale=False)

    try:
        publish("running")
        while True:
            # Commands are scoped by the parent run's random nonce and exact row ID.
            by_id = {row["task_id"]: i for i, row in enumerate(rows)}
            for command in directory.glob(f"zhs-stop-{token}-*"):
                task_id = command.name[len(f"zhs-stop-{token}-"):]
                index = by_id.get(task_id)
                try:
                    valid = (not command.is_symlink() and command.stat().st_size == 32
                             and command.read_text(encoding="ascii") == task_id)
                    if valid and index is not None and rows[index]["state"] in ("queued", "running"):
                        stop(index)
                except (OSError, UnicodeError):
                    pass
                finally:
                    command.unlink(missing_ok=True)
            for index, (child, child_token) in list(running.items()):
                code = child.poll()
                percent, playback_phase = local_observation(directory, child_token)
                if percent is not None and targets[index].kind == "video":
                    had_sample.add(index)
                stale = sampling_is_stale(
                    targets[index].kind, percent, had_sample=index in had_sample,
                    running_seconds=time.monotonic() - started_at.get(index, time.monotonic()),
                ) and playback_phase not in ("paused", "answering")
                rows[index].update(
                    percent=percent if targets[index].kind == "video" else None,
                    playback_phase=playback_phase if targets[index].kind == "video" else None,
                    stale=stale,
                )
                if code is not None:
                    rows[index].update(state="exited" if code == 0 else
                                       "unconfirmed" if code in (16, 17) else "failed", exit_code=code,
                                       percent=None, playback_phase=None, stale=True)
                    child_fatal = fatal_diagnostic(directory, child_token)
                    if child_fatal:
                        fatal = child_fatal
                    terminate(child)
                    running.pop(index)
                    for prefix in ("monitor-zhs-", "zhs-diagnostic-"):
                        (directory / f"{prefix}{child_token}.json").unlink(missing_ok=True)
                    if code != 0:
                        exit_code = 13
            if deadline is not None and time.monotonic() >= deadline:
                exit_code = 12
                break
            if fatal or (exit_code and stop_on_error):
                break
            # Claim only the earliest queued resource per chapter. A video,
            # article or PPT blocks its own chapter but never a different one.
            # For legacy/unclassified QueueTargets, use a unique lane key.
            def lane_key(index):
                return targets[index].chapter_key or targets[index].task_id

            busy_lanes = {lane_key(index) for index in running}
            claimed_lanes = set()
            for index, target in enumerate(targets):
                if len(running) >= concurrency:
                    break
                if rows[index]["state"] != "queued":
                    continue
                lane = lane_key(index)
                if lane in claimed_lanes:
                    continue
                claimed_lanes.add(lane)
                if lane in busy_lanes:
                    continue
                child_token = uuid.uuid4().hex
                try:
                    running[index] = (launch(target, child_token), child_token)
                    started_at[index] = time.monotonic()
                    rows[index]["state"] = "running"
                    busy_lanes.add(lane)
                except OSError:
                    rows[index].update(state="failed", exit_code=1)
                    exit_code = 13
                    if stop_on_error:
                        break
            if exit_code and stop_on_error:
                break
            publish("running")
            if not running and not any(row["state"] == "queued" for row in rows):
                break
            time.sleep(.1)
    finally:
        for index, row in enumerate(rows):
            if row["state"] in ("queued", "running"):
                stop(index)
        publish("exited", force=True)
        if fatal:
            try:
                atomic_json(directory / f"zhs-diagnostic-{token}.json", {
                    "v":1, "token":token, "at":time.time(), "code":fatal,
                })
            except OSError:
                # A diagnostic-file problem cannot change the real task result.
                pass
    return exit_code


def run_queue(course_key: str, token: str, options: dict) -> int:
    from studyflow.services.legacy_playback import _current_course_row
    from dataclasses import asdict
    from studyflow.platforms.zhidao.zhs_scope import ScopeInvalid
    started = time.monotonic()
    root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local") / "StudyFlow"
    try:
        targets, limited = discover_targets(_current_course_row(course_key), options)
    except ScopeInvalid:
        return 14
    # No writes or player actions occur before the complete live catalog is known.
    def launch(target: QueueTarget, child_token: str):
        child_options = {**options, "concurrency": 1, "max_videos": 0, "limit_minutes": 0,
                         "stop_on_error": True,
                         "scope_mode": "selected",
                         "selected_ids": [target.knowledge_id or target.resource_id]}
        args = ["--zhs-video-worker", course_key, child_token,
                json.dumps(child_options, separators=(",", ":")),
                json.dumps(asdict(target), ensure_ascii=False, separators=(",", ":"))]
        command = ([sys.executable] if getattr(sys, "frozen", False) else
                   [sys.executable, str(Path(__file__).resolve().parents[3] / "packaging/bridge_entry.py")])
        return subprocess.Popen([*command, *args], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    minutes = options["limit_minutes"]
    remaining = max(.001, minutes * 60 - (time.monotonic() - started)) if minutes else 0
    code = supervise(targets, options["concurrency"], token, root, launch,
                     stop_on_error=options["stop_on_error"], limit_seconds=remaining)
    return code or (12 if limited else 0)


def watch_parent_pipe() -> None:
    """Parent owns the write end. EOF means it exited, including crash/kill."""
    descriptor = sys.stdin.fileno()
    def wait_for_eof():
        try:
            # Never hold BufferedReader's lock across interpreter shutdown:
            # normal worker completion must be able to close stdin safely.
            while os.read(descriptor, 1):
                pass
        finally:
            os._exit(15)
    threading.Thread(target=wait_for_eof, daemon=True).start()


def verify_server_advancement(course_key: str, target: QueueTarget) -> int:
    """Read-only post-run check: 0=server advanced/completed, 16=unchanged, 17=unavailable.

    A transport success or local exit code does not prove a persisted study record.
    The original ZHS reporting algorithm and request format remain untouched.
    """
    from studyflow.services.legacy_playback import _current_course_row
    from zhs.cli.bootstrap import load_config_and_session

    session = None
    try:
        course = _current_course_row(course_key)
        loaded = load_config_and_session(debug=False, console_log=False, proxy=None)
        if loaded is None:
            return 17
        _, session = loaded
        if target.knowledge_id is not None:
            if course["courseType"] != "ai":
                return 17
            from zhs.ai.course import AiCourseManager
            resources = AiCourseManager(session).list_knowledge_resources(
                int(course["courseId"]), int(course["classId"]), target.knowledge_id)
            matches = [r for r in resources
                       if r.resources_detail.resources_uid == target.resource_id]
            if len(matches) != 1:
                return 17
            record = matches[0]
            if record.study_status == 1:
                return 0
            if (target.baseline_progress is not None
                    and type(record.schedule) is int
                    and record.schedule > target.baseline_progress):
                return 0
            return 16

        if course["courseType"] != "shared":
            return 17
        from zhs.zhidao.course import ZhidaoCourseManager
        manager = ZhidaoCourseManager(session)
        route = course.get("recruitAndCourseId")
        if not route:
            found = manager.find_course(int(course["courseId"]))
            if found is None:
                return 17
            route = found.secret
        context = manager.get_context(route, force=True)
        video = context.videos.get(target.resource_id)
        if video is None:
            return 17
        if video.watch_state == 1:
            return 0
        if (target.baseline_progress is not None
                and type(video.study_total_time) in (int, float)
                and math.isfinite(video.study_total_time)
                and video.study_total_time > target.baseline_progress):
            return 0
        return 16
    except Exception:
        # An unreadable platform status is not evidence of a reporting failure.
        return 17
    finally:
        if session is not None:
            try:
                session.close()
            except Exception:
                pass


def video_worker(args: list[str]) -> int:
    from studyflow.platforms.zhidao.zhs_settings import validate_run_settings
    from studyflow.services.legacy_playback import run_zhidao_original, MONITOR_TOKEN, COURSE_KEY
    if len(args) != 4 or not COURSE_KEY.fullmatch(args[0]) or not MONITOR_TOKEN.fullmatch(args[1]):
        return 2
    try:
        if len(args[2]) > 16384 or len(args[3]) > 1024:
            return 2
        options = validate_run_settings(json.loads(args[2]))
        data = json.loads(args[3])
        target = QueueTarget(**data)
        ids = (target.resource_id,) if target.knowledge_id is None else (target.resource_id, target.knowledge_id)
        if (any(type(i) is not int or not 0 < i <= 2**63 - 1 for i in ids)
                or options["concurrency"] != 1 or options["scope_mode"] != "selected"
                or options["selected_ids"] != [target.knowledge_id or target.resource_id]
                or target.kind not in ("video", "ppt", "article", "other")):
            return 2
    except (ValueError, TypeError, KeyError):
        return 2
    watch_parent_pipe()
    code = run_zhidao_original(args[0], args[1], options,
                               target_resource=(target.knowledge_id, target.resource_id))
    return code if code != 0 else verify_server_advancement(args[0], target)
