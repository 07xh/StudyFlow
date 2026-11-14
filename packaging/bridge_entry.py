"""Single packaged StudyFlow Python runtime.

The same bundled interpreter handles versioned JSONL IPC and opt-in local
Zhidao workers. No second Python installation or old ZHSDesktop EXE needed.
"""
from __future__ import annotations

import sys


def _packaged_runtime_self_test() -> int:
    """Verify both platforms and all runtime dependencies inside the frozen EXE."""
    from pathlib import Path

    if not getattr(sys, "frozen", False) or not getattr(sys, "_MEIPASS", None):
        print("[PACKAGED_RUNTIME_FAILED] not running as a frozen executable", file=sys.stderr)
        return 10

    root = Path(sys._MEIPASS)
    required = (
        "legacy/yuketang/main.py",
        "legacy/yuketang/exe_entry.py",
        "legacy/zhidao/ZHS-ConsoleMonitor.py",
        "legacy/zhidao/Zhidao-Task.cmd",
        "legacy/zhidao/Official-Player.ps1",
        "legacy/zhidao/Official-MediaController.js",
        "legacy/zhidao/Zhidao-GUI.ps1",
        "legacy/zhidao/Zhidao-UI.xaml",
        "legacy/zhidao/CookieImport.ps1",
        "legacy/zhidao/SessionState.ps1",
    )
    missing = [name for name in required if not (root / name).is_file()]
    if missing:
        print("[PACKAGED_RUNTIME_FAILED] bundled platform resources are missing: " + ", ".join(missing), file=sys.stderr)
        return 11

    try:
        import requests  # noqa: F401
        import dotenv  # noqa: F401
        import keyring  # noqa: F401
        from importlib.metadata import version
        if version("zhs") != "0.1.5":
            raise RuntimeError("unexpected ZHS version")
        from zhs.login import LoginManager  # noqa: F401
        from zhs.cli.bootstrap import load_config_and_session  # noqa: F401
        from zhs.zhidao.course import ZhidaoCourseManager  # noqa: F401

        # Exercise the actual frozen-resource resolver and recovered original
        # launcher without executing its interactive menu or contacting a server.
        from studyflow.platforms.yuketang import legacy_config
        launcher = legacy_config._launcher()
        if not callable(getattr(launcher, "read_cfg", None)) or not callable(getattr(launcher, "save_cfg", None)):
            raise RuntimeError("original Rain Classroom settings entry is incomplete")
        source = root / "legacy" / "yuketang" / "main.py"
        compile(source.read_text(encoding="utf-8-sig"), str(source), "exec")
    except Exception as exc:
        print("[PACKAGED_RUNTIME_FAILED] dependency or source check: " + type(exc).__name__, file=sys.stderr)
        return 12

    print("[PACKAGED_RUNTIME_OK] frozen Python, dependencies, ZHS 0.1.5, Rain Classroom source and settings entry verified")
    return 0


def _prepare_jsonl_stdout():
    """Preserve the protocol pipe and redirect incidental process output to stderr.

    This is done before importing platform adapters so import-time diagnostics
    from third-party packages cannot corrupt the first JSONL response.
    """
    import os

    stdout = sys.stdout
    stderr = sys.stderr
    if stdout is None or stderr is None:
        raise RuntimeError("JSONL stdout/stderr is unavailable")
    protocol_fd = os.dup(stdout.fileno())
    protocol_output = os.fdopen(
        protocol_fd, "w", encoding="utf-8", buffering=1
    )
    try:
        os.dup2(stderr.fileno(), stdout.fileno())
    except Exception:
        protocol_output.close()
        raise
    sys.stdout = stderr
    return protocol_output


def main() -> int:
    if len(sys.argv) > 1:
        mode = sys.argv[1]
        if mode == "--packaged-runtime-self-test" and len(sys.argv) == 2:
            return _packaged_runtime_self_test()
        if mode == "--zhidao-qr-worker" and len(sys.argv) == 3:
            from studyflow.platforms.zhidao.qr_login_core import main as qr_main
            return qr_main([sys.argv[2]])
        if mode == "--zhidao-readonly" and len(sys.argv) == 3:
            command = sys.argv[2]
            if command not in ("session-check", "doctor-server", "courses", "progress"):
                return 2
            from studyflow.platforms.zhidao.upstream import zhidao_only
            # Explicitly expose only non-mutating operations in StudyFlow.
            if command == "session-check":
                return zhidao_only.doctor_session()
            if command == "doctor-server":
                return zhidao_only.doctor_server()
            if command == "courses":
                return zhidao_only.main("courses")
            if command == "progress":
                return zhidao_only.main("progress")
            return 2
        if mode == "--zhidao-verify-one" and len(sys.argv) == 3:
            from studyflow.platforms.zhidao.verify_entry import main as verify_main
            return verify_main([sys.argv[2]])
        if mode == "--zhidao-env-check" and len(sys.argv) == 2:
            from importlib.metadata import PackageNotFoundError, version
            try:
                if version("zhs") == "0.1.5":
                    from zhs.login import LoginManager  # noqa: F401
                    from zhs.cli.bootstrap import load_config_and_session  # noqa: F401
                    from zhs.zhidao.course import ZhidaoCourseManager  # noqa: F401
                    print("[ZHS_RUNTIME_OK] standalone ZHS 0.1.5 ready")
                    return 0
            except (ImportError, PackageNotFoundError, ValueError, OSError):
                pass
            print("[ZHS_RUNTIME_MISSING] bundled Zhidao dependencies unavailable")
            return 5
        if mode in ("--legacy-yuketang", "--legacy-zhidao"):
            from studyflow.services.legacy_playback import main as legacy_main
            return legacy_main(sys.argv[1:])
        return 2

    protocol_output = _prepare_jsonl_stdout()
    try:
        from studyflow.services.bridge import main as bridge_main
        return bridge_main(protocol_output)
    finally:
        try:
            protocol_output.flush()
        finally:
            protocol_output.close()


if __name__ == "__main__":
    raise SystemExit(main())
