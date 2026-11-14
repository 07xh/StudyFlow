"""Adapter for the unchanged, installed Zhidao Windows Python runtime.

Reads only verified session-bound cache after upstream's real course sync.
The original application, WPF GUI and scripts are not altered or deleted.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys

from studyflow.core.models import Course, Platform

def legacy_script() -> Path:
    root = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ZHSDesktop"
    return root / "payload" / "zhidao_only.py"

def _python_executable() -> Path:
    root = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ZHSDesktop"
    return root / ".venv" / "Scripts" / "python.exe"

def probe_login() -> bool:
    script, python = legacy_script(), _python_executable()
    if not script.is_file() or not python.is_file():
        return False
    try:
        result = subprocess.run([str(python), str(script), "doctor-server"],
                                capture_output=True, text=True, timeout=55,
                                cwd=str(Path.home()), check=False)
        return result.returncode in (0, 7) and "[SESSION_OK]" in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False

def read_courses() -> list[Course]:
    script, python = legacy_script(), _python_executable()
    if not script.is_file() or not python.is_file():
        raise RuntimeError("Zhidao legacy runtime is not installed")
    result = subprocess.run([str(python), str(script), "courses"],
                            capture_output=True, text=True, timeout=120,
                            cwd=str(Path.home()), check=False)
    if result.returncode != 0:
        raise RuntimeError("Zhidao course sync failed")
    # The upstream runtime writes a fingerprint-scoped cache; do not use
    # cache records without independently verifying their envelope.
    cache = Path.home() / ".zhs" / "zhidao-courses.json"
    try:
        data = json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("Zhidao course cache unavailable") from exc
    if not isinstance(data, dict) or data.get("source") != "zhidao" or data.get("schemaVersion") != 4:
        raise RuntimeError("Untrusted Zhidao cache envelope")
    # Session fingerprint validation is performed by the unchanged upstream
    # code during sync. A rotated cookie between sync and read is still a
    # race: compare fingerprint with the upstream HMAC helper before display.
    import hashlib, hmac
    try:
        cookies = (Path.home()/".zhs"/"cookies.json").read_bytes()
        salt = (Path.home()/".zhs"/"zhidao-cache-salt.bin").read_bytes()
        fp = hmac.new(salt, cookies, hashlib.sha256).hexdigest()
    except OSError as exc:
        raise RuntimeError("Session fingerprint unavailable") from exc
    if not hmac.compare_digest(str(data.get("sessionFingerprint", "")), fp):
        raise RuntimeError("Zhidao session changed")
    if data.get("incomplete"):
        raise RuntimeError("Zhidao course sync incomplete")
    rows = data.get("courses")
    if not isinstance(rows, list):
        raise RuntimeError("Invalid Zhidao course data")
    result_courses = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        course_id = row.get("courseId")
        name = row.get("name") or row.get("courseName")
        if course_id is None or not isinstance(name, str) or not name.strip():
            continue
        result_courses.append(Course(platform=Platform.ZHIDAO, course_id=str(course_id),
                                     title=name.strip(), progress_percent=None))
    return result_courses
