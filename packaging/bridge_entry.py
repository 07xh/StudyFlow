"""Single packaged StudyFlow Python runtime.

The same bundled interpreter handles versioned JSONL IPC and opt-in local
Zhidao workers. No second Python installation or old ZHSDesktop EXE needed.
"""
from __future__ import annotations

import sys


def _anchor_zhs_data_directory() -> None:
    """ZHS 0.1.5 resolves .zhs from cwd, not Path.home().

    The Tauri sidecar inherits the GUI's working directory, which may be the
    install directory. Anchor it once at process startup, before QR login,
    session verification or mastery imports the ZHS runtime. This is a
    dedicated child process, so no other application's cwd is changed.
    """
    import os
    from pathlib import Path

    os.chdir(Path.home())


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
    _anchor_zhs_data_directory()
    if len(sys.argv) > 1:
        mode = sys.argv[1]
        if mode == "--zhs-video-worker":
            from studyflow.services.zhs_queue import video_worker
            return video_worker(sys.argv[2:])
        if mode == "--ucampus-socket-env-check" and len(sys.argv) == 2:
            from studyflow.services.runtime_check import check_ucampus_socket
            result = check_ucampus_socket()
            print("[UCAMPUS_SOCKET_RUNTIME_OK]" if result == 0 else "[UCAMPUS_SOCKET_RUNTIME_MISSING]")
            return result
        if mode == "--yuketang-env-check" and len(sys.argv) == 2:
            from studyflow.services.runtime_check import check_yuketang
            result = check_yuketang()
            print("[YKT_RUNTIME_OK]" if result == 0 else "[YKT_RUNTIME_MISSING]")
            return result
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
                    from zhs.__main__ import app  # noqa: F401
                    from zhs.ai import video as zhs_ai_video, course as zhs_ai_course
                    from zhs.hike import video as zhs_hike_video
                    from zhs.zhidao import video as zhs_shared_video
                    from studyflow.services.zhs_upstream_patch import PATCH_ID
                    if any(getattr(module, "STUDYFLOW_ZHS_RELIABILITY_PATCH", None) != PATCH_ID for module in (
                        zhs_ai_video, zhs_ai_course, zhs_hike_video, zhs_shared_video
                    )):
                        raise ImportError("ZHS sender reliability overlay is not included")
                    from studyflow.platforms.zhidao.upstream import zhidao_only  # noqa: F401
                    from studyflow.platforms.zhidao import qr_login_core, verify_entry  # noqa: F401
                    from studyflow.services.legacy_playback import _zhs_monitor_source
                    import runpy
                    monitor_source = _zhs_monitor_source()
                    if not monitor_source.is_file():
                        raise ImportError("bundled ZHS monitor is missing")
                    monitor = runpy.run_path(str(monitor_source), run_name="studyflow_zhs_monitor_check")
                    if not callable(monitor.get("NumericTelemetry")) or not callable(monitor.get("StdoutObserver")):
                        raise ImportError("bundled ZHS monitor entrypoints are unavailable")
                    print("[ZHS_RUNTIME_OK] ZHS 0.1.5 patched reliability runtime and original progress observer ready")
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
