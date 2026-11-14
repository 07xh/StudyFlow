"""Local QR-login lifecycle for StudyFlow's Zhidao platform.

The worker runs in StudyFlow's own Python/PyInstaller runtime. Short-lived
QR images and status files are isolated from the old ZHSDesktop directory.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time

from .qr_login_core import STAGES

def installation_root() -> Path:
    """Private StudyFlow QR directory, never the old Zhidao install tree."""
    local = os.environ.get("LOCALAPPDATA")
    return (Path(local) if local else Path.home() / "AppData" / "Local") / "StudyFlow" / "zhidao"


def python_executable() -> Path:
    """Own interpreter during development or PyInstaller binary when frozen."""
    return Path(sys.executable)


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


def _qr_path(token: str) -> Path:
    return installation_root() / f"studyflow-qr-{token}.png"


def _cleanup_qr(token: str | None) -> None:
    if not token:
        return
    try:
        _qr_path(token).unlink(missing_ok=True)
    except OSError:
        pass


def _cleanup_attempt(token: str | None) -> bool:
    """Remove only the previous attempt's QR and status files.

    A force-killed child cannot execute its finally block. Refuse to start a
    new login if the previous one-use QR cannot be removed.
    """
    if not token:
        return True
    try:
        _qr_path(token).unlink(missing_ok=True)
        _status_path(token).unlink(missing_ok=True)
        return True
    except OSError:
        return False


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


def _fresh_image(token: str, started: float) -> str | None:
    try:
        path = _qr_path(token)
        if path.is_symlink() or not path.is_file():
            return None
        stat = path.stat()
        if not 100 <= stat.st_size <= MAX_QR_SIZE or stat.st_mtime < started - 2:
            return None
        data = path.read_bytes()
        if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) > MAX_QR_SIZE:
            return None
        return base64.b64encode(data).decode("ascii")
    except OSError:
        return None


def start() -> dict:
    global _WORKER, _TOKEN, _STARTED, _FINAL_STAGE
    with _LOCK:
        if _WORKER is not None and _WORKER.poll() is None:
            return {"stage": "busy"}
        # A force-killed QR child may leave its one-use image behind because
        # its finally block never ran. Clean the previous attempt before
        # replacing _TOKEN, otherwise that image becomes unreachable.
        if not _cleanup_attempt(_TOKEN):
            return {"stage": "environment-error"}
        python = python_executable()
        if not python.is_file():
            return {"stage": "environment-error"}
        token = secrets.token_hex(16)
        if _qr_path(token).exists():
            return {"stage": "environment-error"}
        started = time.time()
        try:
            installation_root().mkdir(parents=True, exist_ok=True)
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            arguments = ([str(python), "--zhidao-qr-worker", token]
                         if getattr(sys, "frozen", False)
                         else [str(python), "-m", "studyflow.platforms.zhidao.qr_login_core", token])
            environment = os.environ.copy()
            environment["STUDYFLOW_QR_STATUS_DIR"] = str(installation_root())
            worker = subprocess.Popen(
                arguments, cwd=str(Path.home()), env=environment,
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, creationflags=flags,
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
            _cleanup_qr(_TOKEN)
            return {"stage": stage, "image_png_base64": None}
        stage = stage or "requesting"
        image = _fresh_image(_TOKEN, _STARTED) if stage in ("ready", "requesting") else None
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
        _cleanup_qr(_TOKEN)
        if _TOKEN is not None:
            try:
                _status_path(_TOKEN).unlink(missing_ok=True)
            except OSError:
                pass
        return {"stage": "cancelled"}
