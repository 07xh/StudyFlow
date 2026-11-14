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

from studyflow.platforms.zhidao.courses import progress_key
from studyflow.platforms.zhidao.legacy_runtime import installation_root
from studyflow.platforms.yuketang.credentials import load as load_yuketang
from studyflow.platforms.yuketang.legacy_config import prepare_environment

COURSE_KEY = re.compile(r"^[a-f0-9]{64}$")
ID = re.compile(r"^[0-9]{1,20}$")


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
    # Original exe_entry.py owns .env read/write. Do not import main.py in
    # the persistent JSONL process: the original redirects stdout/stderr.
    try:
        prepare_environment()
    except Exception:
        return 5
    # Upstream main.py configures its own task settings and app logger.
    # Do not import it in the GUI/JSONL process: it redirects stdout/stderr.
    try:
        runpy.run_path(str(original), run_name="__main__")
        return 0
    except SystemExit as exc:
        if isinstance(exc.code, int):
            return exc.code
        return 1
    except Exception:
        # Never print a raw exception that could contain request credentials.
        return 1


def _course_ids_for_current_session(key: str) -> tuple[str, str]:
    if COURSE_KEY.fullmatch(key) is None:
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
               if isinstance(c, dict) and c.get("courseType") == "ai"
               and progress_key(c) == key]
    if len(matches) != 1:
        raise RuntimeError("COURSE_NOT_FOUND")
    selected = matches[0]
    course_id, class_id = str(selected.get("courseId") or ""), str(selected.get("classId") or "")
    if not ID.fullmatch(course_id) or not ID.fullmatch(class_id):
        raise RuntimeError("INVALID_COURSE")
    if int(course_id) <= 0 or int(class_id) <= 0:
        raise RuntimeError("INVALID_COURSE")
    return course_id, class_id


def _run_bundled_zhs(course_id: str, class_id: str) -> int | None:
    """Invoke the exact ZHS 0.1.5 Typer CLI inside the bundled sidecar.

    No source monkey-patches and no reimplementation of the heartbeat code.
    None means an external legacy installation must be used instead.
    """
    from importlib.metadata import PackageNotFoundError, version
    try:
        if version("zhs") != "0.1.5":
            return None
        from zhs.__main__ import app as zhs_app
    except (ImportError, PackageNotFoundError, ValueError):
        return None
    try:
        zhs_app(args=["play", "-c", f"{course_id}:{class_id}", "--type", "ai"],
                standalone_mode=False)
        return 0
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 1
    except Exception:
        return 1


def run_zhidao_original(course_key: str) -> int:
    # Resolve the opaque UI key only inside the authenticated local session.
    try:
        course_id, class_id = _course_ids_for_current_session(course_key)
    except RuntimeError:
        return 4
    bundled = _run_bundled_zhs(course_id, class_id)
    if bundled is not None:
        return bundled
    # Older installs can still run exactly as before, if a pinned packaged
    # ZHS runtime is not available. Never modify the external ZHSDesktop.
    installed = installation_root()
    launcher = installed / "Zhidao-Task.cmd"
    if not launcher.is_file():
        return 5
    # Exactly the upstream launcher and its original ZHS 0.1.5 implementation.
    # No synthetic request generation or sender is rewritten here.
    try:
        completed = subprocess.run(
            [str(launcher), "play-ai", course_id, class_id],
            cwd=Path.home(), stdin=subprocess.DEVNULL, check=False,
        )
        return completed.returncode
    except OSError:
        return 1


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args == ["--legacy-yuketang"]:
        return run_yuketang_original()
    if len(args) == 2 and args[0] == "--legacy-zhidao":
        return run_zhidao_original(args[1])
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
