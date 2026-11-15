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

    @property
    def task_id(self) -> str:
        return hashlib.sha256(f"{self.knowledge_id}:{self.resource_id}".encode()).hexdigest()[:32]


def resource_targets(knowledge_id: int, resources, options: dict) -> list[QueueTarget]:
    result, seen = [], set()
    for resource in resources:
        detail = resource.resources_detail
        if resource.study_status == 1 or (detail.resources_sync_type != 1 and not options["learn_optional"]):
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
            result.append(QueueTarget(uid, knowledge_id, kind, safe_resource_title(detail.resources_name)))
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
            points = {p.knowledge_id: p for theme in info.cake_theme_list for p in theme.knowledge_list}
            if not selected.issubset(points):
                raise ScopeInvalid()
            for kid, point in points.items():
                if (selected and kid not in selected) or point.study_progress >= 101:
                    continue
                targets.extend(resource_targets(kid, manager.list_knowledge_resources(cid, cls, kid), options))
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
            for video in ctx.videos.values():
                if (selected and video.video_id not in selected) or video.watch_state == 1:
                    continue
                targets.append(QueueTarget(video.video_id, None, "video", safe_resource_title(video.name)))
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
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def local_percent(directory: Path, token: str) -> float | None:
    path = directory / f"monitor-zhs-{token}.json"
    try:
        if path.is_symlink() or path.stat().st_size > 2048:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        at, value = data.get("at"), data.get("videoSegmentPercent")
        if (data.get("v") != 1 or data.get("token") != token
                or type(at) not in (int, float) or not math.isfinite(at)
                or not -10 <= time.time() - at <= 18
                or type(value) not in (float, int) or not math.isfinite(value) or not 0 <= value <= 100):
            return None
        return value
    except (OSError, ValueError, TypeError):
        return None


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
    """Bounded process pool with an exclusive barrier around nonvideo resources."""
    directory.mkdir(parents=True, exist_ok=True)
    rows = [{"task_id": t.task_id, "name": t.name, "kind": t.kind,
             "state": "queued", "percent": None, "stale": False, "exit_code": None} for t in targets]
    running = {}  # row index -> (owned process, private telemetry nonce)
    deadline = time.monotonic() + limit_seconds if limit_seconds else None
    exit_code = 0
    fatal = None

    def publish(state):
        atomic_json(directory / f"zhs-queue-{token}.json", {
            "v": 1, "token": token, "at": time.time(), "state": state,
            "concurrency": concurrency, "tasks": rows,
        })

    def stop(index):
        if index in running:
            child, child_token = running.pop(index)
            terminate(child)
            for prefix in ("monitor-zhs-", "zhs-diagnostic-"):
                (directory / f"{prefix}{child_token}.json").unlink(missing_ok=True)
        rows[index].update(state="stopped", percent=None, stale=False)

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
                percent = local_percent(directory, child_token)
                rows[index].update(percent=percent, stale=percent is None)
                if code is not None:
                    rows[index].update(state="exited" if code == 0 else "failed", exit_code=code,
                                       percent=None, stale=True)
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
            for index, target in enumerate(targets):
                if rows[index]["state"] != "queued":
                    continue
                if len(running) >= concurrency:
                    break
                if target.kind != "video" and running:
                    break
                if any(targets[i].kind != "video" for i in running):
                    break
                child_token = uuid.uuid4().hex
                try:
                    running[index] = (launch(target, child_token), child_token)
                    rows[index]["state"] = "running"
                except OSError:
                    rows[index].update(state="failed", exit_code=1)
                    exit_code = 13
                    if stop_on_error:
                        break
                if target.kind != "video":
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
        publish("exited")
        if fatal:
            atomic_json(directory / f"zhs-diagnostic-{token}.json", {
                "v":1, "token":token, "at":time.time(), "code":fatal,
            })
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
    def wait_for_eof():
        try:
            while sys.stdin.buffer.read(1):
                pass
        finally:
            os._exit(15)
    threading.Thread(target=wait_for_eof, daemon=True).start()


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
    return run_zhidao_original(args[0], args[1], options,
                              target_resource=(target.knowledge_id, target.resource_id))
