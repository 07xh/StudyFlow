"""Bridge to the original Zhidao CookieImport.ps1 transaction.

Validation, atomic replacement, server-check rollback and cookie formatting are
implemented by the original PowerShell module. This file only supplies IPC,
temporary input handling and the bundled/development doctor command.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Any


MAX_COOKIE_BYTES = 262_144


def _project_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _legacy_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "legacy" / "zhidao"
    return _project_root() / "legacy" / "zhidao"


def import_cookie(content: Any, mode: Any) -> dict[str, Any]:
    if not isinstance(content, str) or mode not in ("file", "text"):
        raise ValueError("INVALID_COOKIE_IMPORT")
    raw = content.encode("utf-8")
    if not 2 <= len(raw) <= MAX_COOKIE_BYTES:
        raise ValueError("INVALID_COOKIE_IMPORT")
    if os.name != "nt":
        raise RuntimeError("COOKIE_IMPORT_REQUIRES_WINDOWS")

    root = _legacy_root()
    script = root / "CookieImportBridge.ps1"
    if not script.is_file():
        raise RuntimeError("COOKIE_IMPORT_RUNTIME_MISSING")
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    if not powershell:
        raise RuntimeError("POWERSHELL_UNAVAILABLE")

    local = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    temp_root = local / "StudyFlow" / "temporary"
    temp_root.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=temp_root, prefix="zhidao-cookie-", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(raw)

        frozen = bool(getattr(sys, "frozen", False))
        doctor_mode = "frozen" if frozen else "module"
        env = os.environ.copy()
        if not frozen:
            source_path = str(_project_root() / "src")
            env["PYTHONPATH"] = source_path + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")

        command = [
            powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-File", str(script),
            "-Mode", mode,
            "-InputPath", str(temporary),
            "-DoctorExecutable", sys.executable,
            "-DoctorMode", doctor_mode,
        ]
        result = subprocess.run(
            command, cwd=str(_project_root()), env=env,
            stdin=subprocess.DEVNULL, capture_output=True,
            text=True, encoding="utf-8", errors="replace",
            timeout=110,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            check=False,
        )
        for line in reversed(result.stdout.splitlines()):
            try:
                payload = json.loads(line)
            except (TypeError, ValueError):
                continue
            if isinstance(payload, dict) and isinstance(payload.get("imported"), bool):
                message = payload.get("message")
                return {
                    "imported": payload["imported"],
                    "message": message[:300] if isinstance(message, str) else "Cookie 导入结果已返回。",
                }
        return {
            "imported": False,
            "message": "Cookie 导入未返回有效结果；请检查 Windows PowerShell 和原版运行环境。",
        }
    except subprocess.TimeoutExpired:
        return {"imported": False, "message": "服务器核验超时；请重新检测登录状态。"}
    except OSError:
        return {"imported": False, "message": "无法启动原版 Cookie 导入组件。"}
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
