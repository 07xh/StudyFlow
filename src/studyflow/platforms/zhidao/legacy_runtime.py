"""Read-only bridge to the unchanged, installed Zhidao Windows runtime.

The upstream PowerShell/WPF app, QR flow, Python modules and cache format remain
untouched. This adapter never treats a local cookie file as server login proof.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess

from studyflow.core.models import Course, Platform


def installation_root() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "ZHSDesktop"


def legacy_script() -> Path:
    # Installer places payload content directly in ZHSDesktop, not /payload.
    return installation_root() / "zhidao_only.py"


def python_executable() -> Path:
    return installation_root() / ".venv" / "Scripts" / "python.exe"


def _run_readonly(command: str, timeout: int) -> subprocess.CompletedProcess[str]:
    script, python = legacy_script(), python_executable()
    if not script.is_file() or not python.is_file():
        raise RuntimeError("Zhidao legacy installation is missing")
    try:
        return subprocess.run(
            [str(python), str(script), command],
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
        courses.append(Course(platform=Platform.ZHIDAO, course_id=str(identifier),
                              title=title.strip(), progress_percent=None))
    return courses
