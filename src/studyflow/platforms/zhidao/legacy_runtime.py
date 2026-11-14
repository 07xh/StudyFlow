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
import re
from pathlib import Path
import subprocess
import sys

from studyflow.core.models import Course, Platform
from studyflow.platforms.zhidao.courses import progress_key

COURSE_KEY = re.compile(r"^[a-f0-9]{64}$")


def installation_root() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "ZHSDesktop"


def legacy_script() -> Path:
    # Installer places payload content directly in ZHSDesktop, not /payload.
    return installation_root() / "zhidao_only.py"


def python_executable() -> Path:
    return installation_root() / ".venv" / "Scripts" / "python.exe"


def _run_readonly(command: str, timeout: int) -> subprocess.CompletedProcess[str]:
    if command not in ("doctor-server", "courses", "progress"):
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


def _session_course_cache() -> tuple[list[dict], str]:
    directory = Path.home() / ".zhs"
    try:
        cache_path = directory / "zhidao-courses.json"
        if cache_path.stat().st_size > 12 * 1024 * 1024:
            raise RuntimeError("INVALID_CACHE")
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
        cookie = (directory / "cookies.json").read_bytes()
        salt = (directory / "zhidao-cache-salt.bin").read_bytes()
    except (OSError, ValueError) as exc:
        raise RuntimeError("Verified Zhidao course cache is unavailable") from exc

    if not isinstance(cache, dict) or cache.get("source") != "zhidao" or cache.get("schemaVersion") != 4:
        raise RuntimeError("Unexpected Zhidao cache version")
    if len(salt) != 32 or not cookie:
        raise RuntimeError("Zhidao session proof unavailable")
    fingerprint = hmac.new(salt, cookie, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(cache.get("sessionFingerprint") or ""), fingerprint):
        raise RuntimeError("Zhidao session changed")
    if cache.get("incomplete") or cache.get("failedSources") or cache.get("unconfirmedEmptySources"):
        raise RuntimeError("Zhidao returned incomplete course data")
    rows = cache.get("courses")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise RuntimeError("Unexpected Zhidao course format")
    return rows, fingerprint


def _progress_cache(fingerprint: str) -> dict:
    directory = Path.home() / ".zhs"
    path = directory / "zhidao-progress.json"
    try:
        if path.stat().st_size > 16 * 1024 * 1024:
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if (not isinstance(data, dict) or data.get("source") != "zhidao"
            or data.get("schemaVersion") != 4
            or not hmac.compare_digest(str(data.get("sessionFingerprint") or ""), fingerprint)
            or not isinstance(data.get("courses"), list)):
        return {}
    return data


def _progress_percent(row: dict) -> float | None:
    if row.get("stale") is True:
        return None
    if row.get("courseType") == "ai":
        total, done = row.get("knowledgePointCount"), row.get("fullProgressPoints")
    elif row.get("courseType") == "shared":
        total, done = row.get("videoCount"), row.get("completedVideos")
    else:
        return None
    if (isinstance(total, bool) or not isinstance(total, int) or total <= 0
            or isinstance(done, bool) or not isinstance(done, int) or done < 0 or done > total):
        return None
    return round(100.0 * done / total, 1)


def _courses_from_current_cache() -> list[Course]:
    rows, fingerprint = _session_course_cache()
    progress = _progress_cache(fingerprint)
    by_key = {}
    for item in progress.get("courses", []):
        if (isinstance(item, dict) and item.get("courseType") in ("ai", "shared")
                and isinstance(item.get("lastVerifiedAt"), str) and item.get("lastVerifiedAt")
                and item.get("stale") is not True):
            by_key[progress_key(item)] = item

    courses: list[Course] = []
    for row in rows:
        title = row.get("name") or row.get("courseName")
        identifier = row.get("courseId")
        course_type = row.get("courseType")
        if identifier is None or not isinstance(title, str) or not title.strip():
            continue
        if course_type not in ("ai", "shared"):
            continue
        evidence = by_key.get(progress_key(row))
        percent = _progress_percent(evidence) if evidence else None
        verified_at = evidence.get("lastVerifiedAt") if evidence and percent is not None else None
        stale = row.get("stale") is True
        courses.append(Course(
            platform=Platform.ZHIDAO, course_id=progress_key(row),
            title=title.strip(), progress_percent=percent,
            course_type=course_type, stale=stale,
            progress_evidence="server_verified" if verified_at and not stale else None,
            verified_at=verified_at if not stale else None,
        ))
    return courses


def _progress_snapshot() -> dict:
    courses = _courses_from_current_cache()
    _, fingerprint = _session_course_cache()
    progress = _progress_cache(fingerprint)
    return {
        "courses": courses,
        "incomplete": bool(progress.get("incomplete", True)),
        "fetched_at": progress.get("fetchedAt") if isinstance(progress.get("fetchedAt"), str) else None,
    }


def read_courses() -> list[Course]:
    result = _run_readonly("courses", 150)
    if result.returncode != 0:
        raise RuntimeError("Zhidao server course sync failed")
    return _courses_from_current_cache()


def refresh_progress() -> dict:
    # The upstream progress mode only reads server state and updates its local cache.
    result = _run_readonly("progress", 300)
    if result.returncode not in (0, 1):
        raise RuntimeError("Zhidao server progress sync failed")
    return _progress_snapshot()


def verify_course(course_key: str) -> dict:
    if not isinstance(course_key, str) or COURSE_KEY.fullmatch(course_key) is None:
        raise ValueError("INVALID_COURSE")
    rows, _ = _session_course_cache()
    if sum(progress_key(row) == course_key for row in rows) != 1:
        raise RuntimeError("COURSE_NOT_FOUND")
    if getattr(sys, "frozen", False):
        arguments = [sys.executable, "--zhidao-verify-one", course_key]
    else:
        arguments = [sys.executable, "-m", "studyflow.platforms.zhidao.verify_entry", course_key]
    try:
        result = subprocess.run(
            arguments, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=180, cwd=Path.home(), check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("Zhidao single-course verification failed") from exc
    if result.returncode != 0:
        raise RuntimeError("Zhidao single-course verification failed")
    return _progress_snapshot()
