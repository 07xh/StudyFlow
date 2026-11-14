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
import tempfile
from datetime import datetime, timezone
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
    if command not in ("session-check", "doctor-server", "courses", "progress"):
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
        # Use the authentication-only command. The full doctor-server
        # path also queries course APIs and must not delay or redefine login state.
        result = _run_readonly("session-check", 65)
        return any(line.startswith("[SESSION_OK]") for line in (result.stdout or "").splitlines())
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



def _legacy_resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "legacy" / "zhidao"
    return Path(__file__).resolve().parents[4] / "legacy" / "zhidao"


def resolve_course(course_key: str) -> dict:
    if not isinstance(course_key, str) or COURSE_KEY.fullmatch(course_key) is None:
        raise ValueError("INVALID_COURSE")
    rows, _ = _session_course_cache()
    matches = [row for row in rows if progress_key(row) == course_key]
    if len(matches) != 1 or matches[0].get("stale") is True:
        raise RuntimeError("COURSE_NOT_FOUND")
    row = matches[0]
    course_type = row.get("courseType")
    course_id = str(row.get("courseId") or "0")
    class_id = str(row.get("classId") or "0")
    if course_type == "ai":
        if not re.fullmatch(r"[0-9]{1,20}", course_id) or not re.fullmatch(r"[0-9]{1,20}", class_id):
            raise RuntimeError("COURSE_ROUTE_UNAVAILABLE")
        if int(course_id) <= 0 or int(class_id) <= 0:
            raise RuntimeError("COURSE_ROUTE_UNAVAILABLE")
        route = ""
    elif course_type == "shared":
        route = str(row.get("recruitAndCourseId") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_+./=:-]{1,512}", route):
            raise RuntimeError("COURSE_ROUTE_UNAVAILABLE")
        if not re.fullmatch(r"[0-9]{1,20}", course_id):
            course_id = "0"
        if not re.fullmatch(r"[0-9]{1,20}", class_id):
            class_id = "0"
    else:
        raise RuntimeError("COURSE_ROUTE_UNAVAILABLE")
    title = row.get("name") or row.get("courseName") or "知到课程"
    return {
        "course_key": course_key, "course_type": course_type,
        "course_id": course_id, "class_id": class_id,
        "recruit_and_course_id": route, "title": str(title)[:250],
    }


PLAYER_DEFAULTS = {
    "speed": "1.5", "allowMinimize": True, "autoStart": True,
    "autoNext": True, "mode": "official",
}
PLAYER_SPEEDS = {"1", "1.25", "1.5", "2"}


def _player_settings_path() -> Path:
    local = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    return local / "StudyFlow" / "zhidao" / "official-player-settings.json"


def get_player_settings() -> dict:
    path = _player_settings_path()
    # Read the old preference only until StudyFlow has its own saved copy.
    # Upgrading never writes back into the previous application's directory.
    if not path.exists():
        path = installation_root() / "official-player-settings.json"
    settings = dict(PLAYER_DEFAULTS)
    try:
        if path.is_symlink() or path.stat().st_size > 4096:
            return settings
        stored = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return settings
    if not isinstance(stored, dict):
        return settings
    if stored.get("speed") in PLAYER_SPEEDS:
        settings["speed"] = stored["speed"]
    for name in ("allowMinimize", "autoStart", "autoNext"):
        if isinstance(stored.get(name), bool):
            settings[name] = stored[name]
    if stored.get("mode") in ("official", "zhs-original"):
        settings["mode"] = stored["mode"]
    return settings


def save_player_settings(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("INVALID_PLAYER_SETTINGS")
    if value.get("speed") not in PLAYER_SPEEDS:
        raise ValueError("INVALID_PLAYER_SETTINGS")
    if any(not isinstance(value.get(name), bool) for name in ("allowMinimize", "autoStart", "autoNext")):
        raise ValueError("INVALID_PLAYER_SETTINGS")
    mode = value.get("mode", "official")
    if mode not in ("official", "zhs-original"):
        raise ValueError("INVALID_PLAYER_SETTINGS")
    settings = {
        "speed": value["speed"], "allowMinimize": value["allowMinimize"],
        "autoStart": value["autoStart"], "autoNext": value["autoNext"], "mode": mode,
    }
    path = _player_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError("PLAYER_SETTINGS_UNAVAILABLE")
    fd, temporary = tempfile.mkstemp(prefix=".official-player-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(settings, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return settings


def diagnose_server() -> dict:
    result = _run_readonly("doctor-server", 95)
    labels = {
        0: "confirmed", 7: "partial", 6: "server_unconfirmed",
        3: "no_credentials", 4: "session_unconfirmed",
        5: "environment_error", 8: "invalid_credentials",
    }
    allowed = (
        "[AUTH]", "[AUTH_LOCAL_INVALID]", "[AUTH_OR_NETWORK]", "[SESSION_OK]",
        "[SERVER_READ_OK]", "[SERVER_READ_", "[SERVER_UNCONFIRMED]",
        "[SERVER_PARTIAL]", "[SERVER_OK]",
    )
    lines = [
        line[:240] for line in (result.stdout or "").splitlines()
        if line.startswith(allowed)
    ][:16]
    return {"code": int(result.returncode), "state": labels.get(result.returncode, "unknown"), "lines": lines}


def _unlink_zhs_files(names: tuple[str, ...]) -> dict:
    directory = Path.home() / ".zhs"
    if directory.is_symlink():
        raise RuntimeError("ZHS_DATA_PATH_UNSAFE")
    removed = 0
    for name in names:
        path = directory / name
        if path.is_symlink():
            raise RuntimeError("ZHS_DATA_PATH_UNSAFE")
        try:
            if path.exists():
                if not path.is_file():
                    raise RuntimeError("ZHS_DATA_PATH_UNSAFE")
                path.unlink()
                removed += 1
        except OSError as exc:
            raise RuntimeError("ZHS_DATA_CLEAR_FAILED") from exc
    return {"removed": removed}


def clear_session() -> dict:
    # Mirrors the original GUI's sign-out allowlist: Cookie + transient QR only.
    return _unlink_zhs_files(("cookies.json", "qrcode.png"))


def clear_course_cache() -> dict:
    # Mirrors the original GUI's cache-clear action; never removes credentials.
    return _unlink_zhs_files(("zhidao-courses.json", "zhidao-progress.json"))


def read_document(document_id: str) -> dict:
    names = {
        "terms": "使用条款与第三方声明.txt",
        "privacy": "隐私政策与数据说明.txt",
        "license": "LICENSE-GPL-3.0.txt",
        "source": "SOURCE.md",
    }
    if document_id not in names:
        raise ValueError("INVALID_DOCUMENT")
    path = _legacy_resource_root() / names[document_id]
    try:
        if path.is_symlink() or path.stat().st_size > 512 * 1024:
            raise RuntimeError("DOCUMENT_UNAVAILABLE")
        content = path.read_text(encoding="utf-8-sig")
        if document_id == "privacy":
            supplement = _legacy_resource_root() / "StudyFlow-隐私补充说明.txt"
            if supplement.is_symlink() or supplement.stat().st_size > 128 * 1024:
                raise RuntimeError("DOCUMENT_UNAVAILABLE")
            content += "\n\n" + supplement.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise RuntimeError("DOCUMENT_UNAVAILABLE") from exc
    return {"id": document_id, "title": names[document_id], "content": content}



def read_course_detail(course_key: str) -> dict:
    if not isinstance(course_key, str) or COURSE_KEY.fullmatch(course_key) is None:
        raise ValueError("INVALID_COURSE")
    rows, fingerprint = _session_course_cache()
    matches = [row for row in rows if progress_key(row) == course_key]
    if len(matches) != 1:
        raise RuntimeError("COURSE_NOT_FOUND")
    course = matches[0]
    progress = _progress_cache(fingerprint)
    snapshots = progress.get("courses", [])
    matches_progress = [
        row for row in snapshots
        if isinstance(row, dict) and row.get("courseType") == course.get("courseType")
        and progress_key(row) == course_key
    ]
    snapshot = matches_progress[0] if len(matches_progress) == 1 else None
    stale = course.get("stale") is True or (snapshot is not None and snapshot.get("stale") is True)
    verified_at = snapshot.get("lastVerifiedAt") if snapshot and isinstance(snapshot.get("lastVerifiedAt"), str) else None
    course_type = course.get("courseType")
    items: list[dict] = []
    done = total = 0
    if snapshot is not None and course_type == "ai":
        raw_items = snapshot.get("knowledgePoints")
        if isinstance(raw_items, list):
            for item in raw_items[:5000]:
                if not isinstance(item, dict):
                    continue
                percent = item.get("progressPercent")
                if isinstance(percent, bool) or not isinstance(percent, int) or not 0 <= percent <= 100:
                    continue
                items.append({
                    "name": str(item.get("name") or "未命名知识点")[:200],
                    "theme": str(item.get("theme") or "")[:160],
                    "progress_percent": percent,
                    "fully_progressed": percent >= 100,
                })
        total = len(items)
        done = sum(item["fully_progressed"] for item in items)
    elif snapshot is not None and course_type == "shared":
        raw_items = snapshot.get("videos")
        if isinstance(raw_items, list):
            for item in raw_items[:5000]:
                if not isinstance(item, dict):
                    continue
                duration = item.get("durationSeconds")
                studied = item.get("studiedSeconds")
                if (isinstance(duration, bool) or not isinstance(duration, int) or not 0 <= duration <= 864000
                        or isinstance(studied, bool) or not isinstance(studied, int) or not 0 <= studied <= 864000):
                    continue
                completed = item.get("serverCompleted") is True
                items.append({
                    "name": str(item.get("name") or "未命名视频")[:200],
                    "duration_seconds": duration, "studied_seconds": studied,
                    "server_completed": completed,
                })
        total = len(items)
        done = sum(item["server_completed"] for item in items)
    else:
        course_type = "ai" if course_type == "ai" else "shared"
    return {
        "course_key": course_key,
        "title": str(course.get("name") or course.get("courseName") or "知到课程")[:250],
        "course_type": course_type,
        "verified": bool(snapshot is not None and verified_at and not stale),
        "stale": stale,
        "verified_at": verified_at,
        "done": done, "total": total,
        "percent": round(done * 100.0 / total, 1) if total else None,
        "items": items,
    }



def _consent_flag_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    return base / "StudyFlow" / "privacy-accepted-v1.flag"


def consent_status() -> dict:
    path = _consent_flag_path()
    try:
        if path.is_symlink() or path.stat().st_size > 256:
            return {"accepted": False}
        value = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"accepted": False}
    except (OSError, UnicodeError):
        return {"accepted": False}
    return {"accepted": value.startswith("StudyFlow privacy notice v1 accepted at ")}


def accept_consent() -> dict:
    path = _consent_flag_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError("CONSENT_STORAGE_FAILED")
    value = "StudyFlow privacy notice v1 accepted at " + datetime.now(timezone.utc).isoformat()
    fd, temporary = tempfile.mkstemp(prefix=".consent-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return {"accepted": True}
