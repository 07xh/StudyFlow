"""Read-only bridge to StudyFlow bundled Zhidao runtime.

The upstream CLI code is preserved within the StudyFlow Python sidecar.
The original WPF application and ~/.zhs cache format remain untouched.
A local cookie file alone never establishes verified server login.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import sys

from studyflow.core.models import Course, Platform
from studyflow.platforms.zhidao.courses import progress_key


def installation_root() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "ZHSDesktop"


def legacy_script() -> Path:
    # Installer places payload content directly in ZHSDesktop, not /payload.
    return installation_root() / "zhidao_only.py"


def python_executable() -> Path:
    return installation_root() / ".venv" / "Scripts" / "python.exe"


def _run_readonly(command: str, timeout: int) -> subprocess.CompletedProcess[str]:
    if command not in ("doctor-server", "courses"):
        raise RuntimeError("Unsupported Zhidao read-only operation")
    if getattr(sys, "frozen", False):
        arguments = [sys.executable, "--zhidao-readonly", command]
    else:
        arguments = [sys.executable, "-m", "studyflow.platforms.zhidao.upstream.zhidao_only", command]
    try:
        return subprocess.run(
            arguments,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, cwd=Path.home(), check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("Zhidao runtime could not be queried") from exc


def probe_login() -> bool:
    try:
        result = _run_readonly("doctor-server", 65)
        return result.returncode in (0, 7) and "[SESSION_OK]" in result.stdout
    except RuntimeError:
        return False


def read_courses() -> list[Course]:
    result = _run_readonly("courses", 150)
    if result.returncode != 0:
        raise RuntimeError("Zhidao server course sync failed")

    directory = Path.home() / ".zhs"
    try:
        cache = json.loads((directory / "zhidao-courses.json").read_text(encoding="utf-8"))
        cookies = (directory / "cookies.json").read_bytes()
        salt = (directory / "zhidao-cache-salt.bin").read_bytes()
    except (OSError, ValueError) as exc:
        raise RuntimeError("Verified Zhidao course cache is unavailable") from exc

    if not isinstance(cache, dict) or cache.get("source") != "zhidao" or cache.get("schemaVersion") != 4:
        raise RuntimeError("Unexpected Zhidao cache version")
    if len(salt) != 32 or not cookies:
        raise RuntimeError("Zhidao session proof unavailable")
    fingerprint = hmac.new(salt, cookies, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(cache.get("sessionFingerprint") or ""), fingerprint):
        raise RuntimeError("Zhidao session changed")
    if cache.get("incomplete") or cache.get("failedSources") or cache.get("unconfirmedEmptySources"):
        raise RuntimeError("Zhidao returned incomplete course data")

    rows = cache.get("courses")
    if not isinstance(rows, list):
        raise RuntimeError("Unexpected Zhidao course format")
    courses: list[Course] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = row.get("name") or row.get("courseName")
        identifier = row.get("courseId")
        if identifier is None or not isinstance(title, str) or not title.strip():
            continue
        course_type = row.get("courseType")
        if course_type not in ("ai", "shared"):
            continue
        # Stable identity contains type and AI teaching class; raw route tokens
        # never cross the IPC or appear in frontend logs.
        courses.append(Course(
            platform=Platform.ZHIDAO, course_id=progress_key(row),
            title=title.strip(), progress_percent=None,
            course_type=course_type, stale=(row.get("stale") is True),
        ))
    return courses
