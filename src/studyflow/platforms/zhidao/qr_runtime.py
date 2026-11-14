"""Local QR-login lifecycle for StudyFlow's Zhidao platform.

The authentication worker is the migrated ZHS 0.1.5-compatible core. It runs
under the existing Zhidao installation's Python environment, keeping the
original dependencies and cookies; the UI only sees sanitized state and a
short-lived PNG while the code is awaiting scan.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time

from .legacy_runtime import installation_root, python_executable
from .qr_login_core import STAGES

_LOCK = threading.RLock()
_WORKER: subprocess.Popen | None = None
_TOKEN: str | None = None
_STARTED: float = 0.0
_FINAL_STAGE: str | None = None
MAX_QR_SIZE = 1024 * 1024
MAX_STATUS_AGE = 600
TERMINAL = {"verified", "rejected", "expired", "cancelled", "failed",
            "environment-error", "unavailable"}


def _status_path(token: str) -> Path:
    return installation_root() / f"monitor-qr-{token}.json"


def _qr_path() -> Path:
    return Path.home() / ".zhs" / "qrcode.png"


def _cleanup_qr() -> None:
    try:
        _qr_path().unlink(missing_ok=True)
    except OSError:
        pass


def _read_stage(token: str, started: float) -> str | None:
    try:
        path = _status_path(token)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024:
            return None
        state = json.loads(path.read_text(encoding="utf-8-sig"))
        if (not isinstance(state, dict) or state.get("v") != 1
                or state.get("token") != token or state.get("stage") not in STAGES):
            return None
        at = state.get("at")
        if type(at) is not int or at < started - 10 or abs(time.time() - at) > MAX_STATUS_AGE:
            return None
        return state["stage"]
    except (OSError, ValueError, TypeError, KeyError):
        return None


def _fresh_image(started: float) -> str | None:
    try:
        path = _qr_path()
        if path.is_symlink() or not path.is_file():
            return None
        stat = path.stat()
        if not 100 <= stat.st_size <= MAX_QR_SIZE or stat.st_mtime < started - 2:
            return None
        data = path.read_bytes()
        if not data.startswith(b"\\x89PNG\\r\\n\\x1a\\n") or len(data) > MAX_QR_SIZE:
            return None
        return base64.b64encode(data).decode("ascii")
    except OSError:
        return None


def start() -> dict:
    global _WORKER, _TOKEN, _STARTED, _FINAL_STAGE
    with _LOCK:
        if _WORKER is not None and _WORKER.poll() is None:
            return {"stage": "busy"}
        python = python_executable()
        worker_script = Path(__file__).with_name("qr_login_core.py")
        if not python.is_file() or not worker_script.is_file():
            return {"stage": "environment-error"}
        _cleanup_qr()
        if _qr_path().exists():
            return {"stage": "environment-error"}
        token = secrets.token_hex(16)
        started = time.time()
        try:
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            worker = subprocess.Popen(
                [str(python), str(worker_script), token],
                cwd=str(Path.home()), stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=flags,
            )
        except OSError:
            return {"stage": "environment-error"}
        _TOKEN, _STARTED, _WORKER, _FINAL_STAGE = token, started, worker, None
        return {"stage": "requesting"}


def status() -> dict:
    global _FINAL_STAGE
    with _LOCK:
        if _TOKEN is None:
            return {"stage": "idle", "image_png_base64": None}
        stage = _read_stage(_TOKEN, _STARTED)
        running = _WORKER is not None and _WORKER.poll() is None
        if not running:
            if stage not in TERMINAL:
                stage = _FINAL_STAGE or "failed"
            _FINAL_STAGE = stage
            _cleanup_qr()
            return {"stage": stage, "image_png_base64": None}
        stage = stage or "requesting"
        image = _fresh_image(_STARTED) if stage in ("ready", "requesting") else None
        return {"stage": stage, "image_png_base64": image}


def cancel() -> dict:
    global _FINAL_STAGE
    with _LOCK:
        if _WORKER is not None and _WORKER.poll() is None:
            _WORKER.terminate()
            try:
                _WORKER.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _WORKER.kill()
                _WORKER.wait(timeout=5)
        _FINAL_STAGE = "cancelled"
        _cleanup_qr()
        if _TOKEN is not None:
            try:
                _status_path(_TOKEN).unlink(missing_ok=True)
            except OSError:
                pass
        return {"stage": "cancelled"}
