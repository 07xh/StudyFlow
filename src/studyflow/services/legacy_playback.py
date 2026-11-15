"""Launch *unchanged* legacy playback executors in isolated child processes.

This module is a process/identity adapter, not a heartbeat implementation.
Zhidao uses its installed ZHS 0.1.5 task launcher; YKT runs the byte-for-byte
upstream main.py from the StudyFlow Windows package. No algorithm replacement.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import threading
import time

from studyflow.platforms.zhidao.courses import progress_key
from studyflow.platforms.zhidao.legacy_runtime import installation_root
from studyflow.platforms.zhidao.zhs_settings import (
    validate_run_settings as validate_zhs_settings,
)
from studyflow.platforms.zhidao.zhs_scope import (
    scoped_upstream_play, ScopeLimitReached, ScopeFailed, ScopeInvalid,
)
from studyflow.platforms.yuketang.credentials import load as load_yuketang
from studyflow.platforms.yuketang.legacy_config import default_config_home, prepare_environment

COURSE_KEY = re.compile(r"^[a-f0-9]{64}$")
ID = re.compile(r"^[0-9]{1,20}$")
MONITOR_TOKEN = re.compile(r"^[0-9a-f]{32}$")


def _legacy_source() -> Path:
    # PyInstaller copies the original under the bundle's internal directory.
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "legacy" / "yuketang" / "main.py"
    return Path(__file__).resolve().parents[3] / "legacy" / "yuketang" / "main.py"


def run_yuketang_original() -> int:
    cfg = load_yuketang()
    if cfg is None:
        return 4
    original = _legacy_source()
    if not original.is_file():
        return 5
    values = {
        "SESSION_ID": cfg.session_id,
        "CSRF_TOKEN": cfg.csrf_token,
        "CLASSROOM_ID": cfg.classroom_id,
        "UNIVERSITY_ID": cfg.university_id,
        "SIGN": cfg.sign,
    }
    # Override an old .env with the currently chosen StudyFlow credential.
    os.environ.update(values)
    root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    log_dir = root / "StudyFlow" / "legacy-logs"
    # The Tauri launcher assigns a separate log folder to each run. The
    # original main.py is unchanged; without a launcher token, retain the
    # original log location for standalone backwards compatibility.
    from studyflow.services.yuketang_progress import RUN_ID
    run_id = os.environ.get("STUDYFLOW_YKT_RUN_ID", "")
    if run_id and RUN_ID.fullmatch(run_id):
        log_dir = log_dir / run_id
    log_dir.mkdir(parents=True, exist_ok=True)
    os.environ["YKT_HOME"] = str(log_dir)
    # Keep scoped progress logs and load original launcher options.
    try:
        prepare_environment(default_config_home())
    except Exception:
        return 5
    # Upstream main.py configures its own task settings and app logger.
    # Do not import it in the GUI/JSONL process: it redirects stdout/stderr.
    try:
        from studyflow.services.yuketang_worker_observer import attribute_worker_progress
        # Only annotate output from the original Worker's actual call stack.
        # This never modifies legacy/yuketang/main.py or network payloads.
        with attribute_worker_progress():
            runpy.run_path(str(original), run_name="__main__")
        return 0
    except SystemExit as exc:
        if isinstance(exc.code, int):
            return exc.code
        return 1
    except Exception:
        # Never print a raw exception that could contain request credentials.
        return 1


def _current_course_row(key: str) -> dict:
    """Resolve only a fresh course from the currently authenticated cache."""
    if not isinstance(key, str) or COURSE_KEY.fullmatch(key) is None:
        raise RuntimeError("INVALID_COURSE")
    data_dir = Path.home() / ".zhs"
    try:
        cookie = (data_dir / "cookies.json").read_bytes()
        salt = (data_dir / "zhidao-cache-salt.bin").read_bytes()
        cache_path = data_dir / "zhidao-courses.json"
        if cache_path.stat().st_size > 12 * 1024 * 1024:
            raise RuntimeError("INVALID_CACHE")
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("SESSION_NOT_READY") from exc
    if len(salt) != 32 or not cookie:
        raise RuntimeError("SESSION_NOT_READY")
    fingerprint = hmac.new(salt, cookie, hashlib.sha256).hexdigest()
    if not isinstance(cache, dict) or cache.get("source") != "zhidao" or cache.get("schemaVersion") != 4:
        raise RuntimeError("INVALID_CACHE")
    if not hmac.compare_digest(str(cache.get("sessionFingerprint") or ""), fingerprint):
        raise RuntimeError("SESSION_CHANGED")
    if not isinstance(cache.get("courses"), list):
        raise RuntimeError("INVALID_CACHE")
    matches = [c for c in cache["courses"]
               if isinstance(c, dict) and c.get("courseType") in ("ai", "shared")
               and progress_key(c) == key and c.get("stale") is not True]
    if len(matches) != 1:
        raise RuntimeError("COURSE_NOT_FOUND")
    return matches[0]


def _ai_course_ids(row: dict) -> tuple[str, str]:
    course_id, class_id = str(row.get("courseId") or ""), str(row.get("classId") or "")
    if not ID.fullmatch(course_id) or not ID.fullmatch(class_id):
        raise RuntimeError("INVALID_COURSE")
    if int(course_id) <= 0 or int(class_id) <= 0:
        raise RuntimeError("INVALID_COURSE")
    return course_id, class_id


def _course_ids_for_current_session(key: str) -> tuple[str, str]:
    """Retain the original AI-course helper for existing integrations."""
    row = _current_course_row(key)
    if row.get("courseType") != "ai":
        raise RuntimeError("COURSE_NOT_AI")
    return _ai_course_ids(row)


_SHARED_ROUTE = re.compile(r"^[A-Za-z0-9_+./=:-]{1,512}$")


def _shared_play_arguments(row: dict) -> list[str]:
    """Use the upstream ZHS shared-course URL resolver, never a guessed ID."""
    from urllib.parse import quote
    route = str(row.get("recruitAndCourseId") or "").strip()
    if _SHARED_ROUTE.fullmatch(route):
        url = "https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=" + quote(route, safe="")
        return ["play", "--url", url]
    course_id = str(row.get("courseId") or "").strip()
    if ID.fullmatch(course_id) and int(course_id) > 0:
        return ["play", "-c", course_id, "--type", "zhidao"]
    raise RuntimeError("COURSE_ROUTE_UNAVAILABLE")


def _zhs_monitor_source() -> Path:
    """Original read-only console observer, copied byte-for-byte from ZHSDesktop."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "legacy" / "zhidao" / "ZHS-ConsoleMonitor.py"
    return Path(__file__).resolve().parents[3] / "legacy" / "zhidao" / "ZHS-ConsoleMonitor.py"


class _RefreshingZhsSink:
    """Refresh unchanged numeric output at most every five seconds.

    The vendored observer intentionally suppresses duplicate frames. Without
    periodic refresh, a running CLI reporting the same percentage would look
    stale after the Rust supervisor's 18-second freshness window. This wrapper
    never generates or sends heartbeats; it only refreshes local observations.
    """

    def __init__(self, sink):
        self.sink = sink
        self.last_publish = time.monotonic()
        self.disabled = False
        # stdout and stderr may be written from different ZHS worker threads.
        # Serialize local observer state; never touch the upstream sender.
        self._lock = threading.Lock()

    def receive(self, chunk: str) -> None:
        with self._lock:
            # Monitoring is strictly optional. Once its filesystem fails, disable
            # telemetry for this run rather than retrying failed writes on every
            # CLI output chunk. Do not change the original executor's result.
            if self.disabled:
                return
            previous = self.sink.last_snapshot
            now = time.monotonic()
            refresh_due = previous is not None and now - self.last_publish >= 5.0
            if refresh_due:
                self.sink.last_snapshot = None
            try:
                self.sink.receive(chunk)
            except Exception:
                # Original StdoutObserver already isolates observer errors; keep
                # this wrapper best-effort too and stop repeated expensive retries.
                self.sink.last_snapshot = previous
                self.disabled = True
                return
            current = self.sink.last_snapshot
            if current is None:
                # No valid numeric output: unrelated CLI chatter must not reset
                # refresh cadence or revive a last-known percentage.
                self.sink.last_snapshot = previous
            elif refresh_due or current != previous:
                self.last_publish = now


# Per-run *bounded category*, not a traceback: ZHS CLI errors may contain
# cookies, request URLs, headers or user details. Never persist exception text.
_ZHS_DIAGNOSTIC_CODES = frozenset({
    "CAPTCHA_REQUIRED", "TIME_RESTRICTED", "LOGIN_REQUIRED",
    "NETWORK_ERROR", "LOCAL_FILE_MISSING", "FILE_PERMISSION_DENIED",
    "INTERACTIVE_INPUT_REQUIRED", "UPSTREAM_NONZERO_EXIT",
    "EXECUTOR_EXCEPTION", "WORKER_ENTRY_EXCEPTION",
})


def _classify_zhs_failure(exc: BaseException) -> str:
    name = type(exc).__name__
    if name == "CaptchaRequired":
        return "CAPTCHA_REQUIRED"
    if name == "TimeLimitExceeded":
        return "TIME_RESTRICTED"
    if name in ("AuthenticationError", "LoginError", "LoginExpired", "UnauthorizedError"):
        return "LOGIN_REQUIRED"
    if isinstance(exc, (ConnectionError, TimeoutError)) or name in (
        "ConnectionError", "ReadTimeout", "ConnectTimeout", "HTTPError", "RequestException",
    ):
        return "NETWORK_ERROR"
    if isinstance(exc, FileNotFoundError):
        return "LOCAL_FILE_MISSING"
    if isinstance(exc, PermissionError):
        return "FILE_PERMISSION_DENIED"
    if isinstance(exc, EOFError):
        return "INTERACTIVE_INPUT_REQUIRED"
    return "EXECUTOR_EXCEPTION"


def _write_zhs_diagnostic(monitor_token: str | None, code: str) -> None:
    if (monitor_token is None or MONITOR_TOKEN.fullmatch(monitor_token) is None
            or code not in _ZHS_DIAGNOSTIC_CODES):
        return
    # Local per-run file is consumed and removed by the Rust supervisor on exit.
    # Does not contain course IDs, endpoints, exception strings or credentials.
    try:
        root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "StudyFlow"
        root.mkdir(parents=True, exist_ok=True)
        destination = root / f"zhs-diagnostic-{monitor_token}.json"
        payload = json.dumps({"v": 1, "token": monitor_token, "code": code,
                              "at": time.time()}, separators=(",", ":"))
        fd, temporary = tempfile.mkstemp(prefix=".zhs-diag-", suffix=".tmp", dir=root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    except OSError:
        # Telemetry is optional. Never alter the original ZHS exit semantics.
        pass


def _run_bundled_zhs_args(arguments: list[str], monitor_token: str | None = None,
                          options: dict | None = None, is_ai: bool = False) -> int | None:
    """Run upstream ZHS 0.1.5 CLI unchanged; None means no bundled runtime."""
    from importlib.metadata import PackageNotFoundError, version
    try:
        if version("zhs") != "0.1.5":
            return None
        from zhs.__main__ import app as zhs_app
    except (ImportError, PackageNotFoundError, ValueError):
        return None
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    sink = None
    try:
        if monitor_token:
            try:
                original = _zhs_monitor_source()
                if original.is_file():
                    observer = runpy.run_path(str(original), run_name="studyflow_vendor_zhs_monitor")
                    root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
                    sink = _RefreshingZhsSink(
                        observer["NumericTelemetry"](monitor_token, directory=root / "StudyFlow")
                    )
                    # Rich-based CLIs may emit progress to stderr, not stdout.
                    # Each observer forwards output unchanged and stores numbers only.
                    sys.stdout = observer["StdoutObserver"](original_stdout, sink)
                    sys.stderr = observer["StdoutObserver"](original_stderr, sink)
            except (OSError, ValueError, KeyError):
                sink = None
                sys.stdout = original_stdout
                sys.stderr = original_stderr
        # Per-run scope only controls the original traversal; not heartbeat sender.
        with scoped_upstream_play(options, is_ai):
            result = zhs_app(args=arguments, standalone_mode=False)
        # Click/Typer may return an exit code when standalone_mode is false.
        code = result if isinstance(result, int) else 0
        if code != 0:
            _write_zhs_diagnostic(monitor_token, "UPSTREAM_NONZERO_EXIT")
        return code
    except ScopeLimitReached:
        return 12
    except ScopeFailed:
        return 13
    except ScopeInvalid:
        return 14
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 1
        if code != 0:
            _write_zhs_diagnostic(monitor_token, "UPSTREAM_NONZERO_EXIT")
        return code
    except EOFError:
        # A hidden, noninteractive process cannot answer an upstream prompt.
        _write_zhs_diagnostic(monitor_token, "INTERACTIVE_INPUT_REQUIRED")
        return 9
    except Exception as exc:
        # Click's Exit(code) is not SystemExit; do not mark an exit(0) as a failure.
        if type(exc).__name__ == "Exit" and isinstance(getattr(exc, "exit_code", None), int):
            if exc.exit_code != 0:
                _write_zhs_diagnostic(monitor_token, "UPSTREAM_NONZERO_EXIT")
            return exc.exit_code
        _write_zhs_diagnostic(monitor_token, _classify_zhs_failure(exc))
        return 1
    finally:
        # The Rust supervisor reads the final numeric observation before
        # deleting it. Removing this in the worker loses the last frame.
        sys.stdout = original_stdout
        sys.stderr = original_stderr


def _run_bundled_zhs(course_id: str, class_id: str, monitor_token: str | None = None) -> int | None:
    """Compatibility wrapper for the original AI-course invocation."""
    return _run_bundled_zhs_args(
        ["play", "-c", f"{course_id}:{class_id}", "--type", "ai"], monitor_token
    )


def run_zhidao_original(course_key: str, monitor_token: str | None = None, zhs_options: dict | None = None) -> int:
    if monitor_token is not None and MONITOR_TOKEN.fullmatch(monitor_token) is None:
        return 2
    try:
        options = validate_zhs_settings(zhs_options) if zhs_options is not None else None
    except ValueError:
        return 2
    try:
        course = _current_course_row(course_key)
        is_ai = course["courseType"] == "ai"
        if is_ai:
            course_id, class_id = _ai_course_ids(course)
            arguments = ["play", "-c", f"{course_id}:{class_id}", "--type", "ai"]
        else:
            arguments = _shared_play_arguments(course)
    except RuntimeError as exc:
        if str(exc) in ("INVALID_COURSE", "COURSE_NOT_FOUND", "COURSE_NOT_AI", "COURSE_ROUTE_UNAVAILABLE"):
            return 6
        return 4

    # Documented upstream flags only: no replacement heartbeat sender.
    if options is not None:
        # Shared ZHS uses speed + uniform(-0.15, 0.15); clamp its base.
        effective_speed = min(options["speed"], options["speed_cap"] - (0.15 if not is_ai else 0.0))
        arguments.extend(["--speed", str(round(effective_speed, 4))])
        if options["limit_minutes"]:
            arguments.extend(["--limit", str(options["limit_minutes"])])
        if is_ai and options["learn_optional"]:
            arguments.append("--learn-optional")
    # Old AI wrapper is retained for callers without custom options.
    if options is None and is_ai:
        bundled = _run_bundled_zhs(course_id, class_id, monitor_token)
    elif options is None:
        # Old callers keep the two-argument upstream compatibility wrapper.
        bundled = _run_bundled_zhs_args(arguments, monitor_token)
    else:
        bundled = _run_bundled_zhs_args(arguments, monitor_token, options, is_ai)
    if bundled is not None:
        return bundled

    # Older ZHSDesktop installs are a fallback only; no upstream files edited.
    installed = installation_root()
    if is_ai:
        # The original .cmd fallback does not support flags. Do not silently drop custom settings.
        if options is not None:
            return 5  # The original .cmd cannot honor scoped or bounded options.
        executable = installed / "Zhidao-Task.cmd"
        command = [str(executable), "play-ai", course_id, class_id]
    else:
        if options is not None:
            return 5
        executable = installed / ".venv" / "Scripts" / "zhs.exe"
        command = [str(executable), *arguments]
    if not executable.is_file():
        return 5
    try:
        completed = subprocess.run(
            command, cwd=Path.home(), stdin=subprocess.DEVNULL, check=False,
        )
        return completed.returncode
    except OSError:
        return 1


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args == ["--legacy-yuketang"]:
        return run_yuketang_original()
    if len(args) in (2, 3, 4) and args[0] == "--legacy-zhidao":
        if len(args) == 4:
            try:
                if len(args[3]) > 16384:
                    return 2
                options = validate_zhs_settings(json.loads(args[3]))
            except (ValueError, TypeError):
                return 2
        else:
            options = None
        token = args[2] if len(args) >= 3 else None
        try:
            return run_zhidao_original(args[1], token, options)
        except Exception:
            # A failure outside upstream CLI must still be visible as a safe
            # category; never persist exception strings from account/cache code.
            _write_zhs_diagnostic(token, "WORKER_ENTRY_EXCEPTION")
            return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
