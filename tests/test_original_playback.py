"""Offline regression for original, unmodified legacy executors (no network)."""
from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from studyflow.platforms.zhidao.courses import progress_key
from studyflow.services import legacy_playback as legacy

ROOT = Path(__file__).resolve().parents[1]

# Git SHA-1 of each original file. Tests catch accidental edits to the vendors.
ORIGINAL_BLOBS = {
    "legacy/yuketang/main.py": "1e64ab67376c43060e1dcdf4dfa9949b6bb27b8c",
    "legacy/yuketang/exe_entry.py": "7a3399f3cd30d8b046225fa25940b5b835938cf8",
    "legacy/yuketang/requirements.txt": "ac5f657f4c989d82ea5d1d82eebed91bccb0f8ce",
    "legacy/zhidao/Zhidao-Task.cmd": "8c4d45265a48e47479ce8129887ebe08976e0e36",
    "legacy/zhidao/HeartbeatMonitor.ps1": "1a466a76eb0c2339add85cd3953a6a3711731f8b",
    "legacy/zhidao/HeartbeatView.ps1": "7d89dafb4f60373b97b635560416495c0f4146c7",
    "legacy/zhidao/ZHS-ConsoleMonitor.py": "fbff5bce350245ddf4dfde42ea8a18db944ff307",
    "legacy/zhidao/Official-Player.ps1": "5c71d9551886450b0480cba9434072b71ad10fc6",
    "legacy/zhidao/Official-MediaController.js": "fed27706722d6339028863ab4a839796eaedb527",
}


def _blob_sha(path):
    """Verify original source in both a Git checkout and portable source ZIP."""
    import subprocess
    source = ROOT / path
    assert source.is_file()
    if (ROOT / ".git").exists():
        result = subprocess.run(
            ["git", "rev-parse", f"HEAD:{path}"], cwd=ROOT,
            check=True, capture_output=True, text=True, timeout=10,
        )
        subprocess.run(
            ["git", "diff", "--exit-code", "--quiet", "HEAD", "--", path],
            cwd=ROOT, check=True, capture_output=True, text=True, timeout=10,
        )
        return {result.stdout.strip()}
    data = source.read_bytes()
    def git_blob(content: bytes) -> str:
        return hashlib.sha1(b"blob " + str(len(content)).encode() + bytes([0]) + content).hexdigest()
    return {git_blob(data), git_blob(data.replace(bytes([13, 10]), bytes([10])))}

@pytest.mark.parametrize("filename,expected", list(ORIGINAL_BLOBS.items()))
def test_source_is_byte_for_byte_original(filename, expected):
    assert expected in _blob_sha(filename)


def test_original_ykt_launcher_config_and_no_import_side_effects(monkeypatch, tmp_path):
    cfg = SimpleNamespace(
        session_id="offline-session", csrf_token="offline-csrf",
        classroom_id="234", university_id="567", sign="test-sign",
    )
    original = tmp_path / "main.py"
    original.write_text("# never executed in this test", encoding="utf-8")
    monkeypatch.setattr(legacy, "load_yuketang", lambda: cfg)
    monkeypatch.setattr(legacy, "_legacy_source", lambda: original)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    called = []

    def inspect(path, *, run_name):
        called.append((path, run_name))
        assert legacy.os.environ["SESSION_ID"] == "offline-session"
        assert legacy.os.environ["CSRF_TOKEN"] == "offline-csrf"
        assert legacy.os.environ["CLASSROOM_ID"] == "234"

    monkeypatch.setattr(legacy.runpy, "run_path", inspect)
    assert legacy.run_yuketang_original() == 0
    assert called == [(str(original), "__main__")]
    assert (tmp_path / "StudyFlow" / "legacy-logs").is_dir()


def test_original_ykt_requires_existing_user_session(monkeypatch):
    monkeypatch.setattr(legacy, "load_yuketang", lambda: None)
    monkeypatch.setattr(legacy.runpy, "run_path", lambda *_a, **_kw: pytest.fail("Must not run"))
    assert legacy.run_yuketang_original() == 4


def test_original_zhs_resolves_only_current_session_course(monkeypatch, tmp_path):
    home = tmp_path / "home"
    data = home / ".zhs"
    data.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    cookies = b"fake-demo-cookies"
    salt = b"x" * 32
    (data / "cookies.json").write_bytes(cookies)
    (data / "zhidao-cache-salt.bin").write_bytes(salt)
    course = {"courseType": "ai", "courseId": "20", "classId": "30", "name": "offline"}
    key = progress_key(course)
    cache = {
        "source": "zhidao", "schemaVersion": 4,
        "sessionFingerprint": hmac.new(salt, cookies, hashlib.sha256).hexdigest(),
        "courses": [course],
    }
    (data / "zhidao-courses.json").write_text(json.dumps(cache), encoding="utf-8")
    assert legacy._course_ids_for_current_session(key) == ("20", "30")
    with pytest.raises(RuntimeError):
        legacy._course_ids_for_current_session("0" * 64)
    (data / "cookies.json").write_bytes(b"rotated")
    with pytest.raises(RuntimeError, match="SESSION_CHANGED"):
        legacy._course_ids_for_current_session(key)


def test_zhs_invokes_exact_original_task_without_rewriting_sender(monkeypatch, tmp_path):
    cmd = tmp_path / "Zhidao-Task.cmd"
    cmd.write_text("rem fake file, never run", encoding="utf-8")
    monkeypatch.setattr(legacy, "_run_bundled_zhs", lambda *_a: None)
    monkeypatch.setattr(legacy, "installation_root", lambda: tmp_path)
    monkeypatch.setattr(legacy, "_current_course_row", lambda key: {"courseType": "ai", "courseId": "20", "classId": "30"})
    calls = []

    def no_process(argv, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(legacy.subprocess, "run", no_process)
    assert legacy.run_zhidao_original("a" * 64) == 0
    assert calls == [[str(cmd), "play-ai", "20", "30"]]


def test_bundled_zhs_calls_original_typer_app(monkeypatch):
    import sys
    from types import ModuleType
    package = ModuleType("zhs")
    cli = ModuleType("zhs.__main__")
    calls = []
    cli.app = lambda **kwargs: calls.append(kwargs)
    monkeypatch.setitem(sys.modules, "zhs", package)
    monkeypatch.setitem(sys.modules, "zhs.__main__", cli)
    from importlib import metadata
    monkeypatch.setattr(metadata, "version", lambda name: "0.1.5" if name == "zhs" else "0")
    assert legacy._run_bundled_zhs("20", "30") == 0
    assert calls == [{
        "args": ["play", "-c", "20:30", "--type", "ai"],
        "standalone_mode": False,
    }]


def test_legacy_cli_rejects_unknown_commands():
    assert legacy.main(["--legacy-unknown"]) == 2


def test_tauri_task_manager_keeps_original_qr_and_supported_platforms():
    root = ROOT / "src-tauri" / "src"
    lib = (root / "lib.rs").read_text(encoding="utf-8")
    tasks = (root / "legacy_tasks.rs").read_text(encoding="utf-8")
    assert "QrBridgeWorker" in lib and "legacy_tasks::legacy_start" in lib
    assert "legacy_tasks::legacy_stop" in lib
    assert "legacy_tasks::LegacyTasks::default()" in lib
    assert "taskkill" in tasks and '"--legacy-yuketang"' in tasks
    assert '"--legacy-zhidao"' in tasks


def test_zhs_shared_course_uses_safe_upstream_url_without_rewriting_sender(monkeypatch):
    """Only URL-safe identities survive ZHS 0.1.5's alphanumeric URL parser."""
    route = "abc123XYZ"
    row = {"courseType": "shared", "courseId": "0", "recruitAndCourseId": route}
    monkeypatch.setattr(legacy, "_current_course_row", lambda key: row)
    seen = []
    monkeypatch.setattr(legacy, "_run_bundled_zhs_args",
                        lambda args, token: seen.append((args, token)) or 0)
    assert legacy.run_zhidao_original("a" * 64, "b" * 32) == 0
    assert seen == [([
        "play", "--url",
        "https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=" + route,
    ], "b" * 32)]


def test_shared_course_encoded_identifier_falls_back_to_upstream_course_lookup(monkeypatch):
    """Percent encoding cannot fix the upstream parser's [A-Za-z0-9]+ regex."""
    row = {"courseType": "shared", "courseId": "123",
           "recruitAndCourseId": "example+route/=="}
    monkeypatch.setattr(legacy, "_current_course_row", lambda key: row)
    calls = []
    monkeypatch.setattr(legacy, "_run_bundled_zhs_args",
                        lambda args, token: calls.append(args) or 0)
    assert legacy.run_zhidao_original("a" * 64) == 0
    assert calls == [["play", "-c", "123", "--type", "zhidao"]]


def test_shared_course_rejects_unparseable_opaque_route_without_numeric_id(monkeypatch):
    row = {"courseType": "shared", "courseId": "0",
           "recruitAndCourseId": "example+route/=="}
    monkeypatch.setattr(legacy, "_current_course_row", lambda key: row)
    monkeypatch.setattr(legacy, "_run_bundled_zhs_args",
                        lambda *args: pytest.fail("must not pass a truncated course identifier"))
    assert legacy.run_zhidao_original("a" * 64) == 6


def test_shared_zhs_course_with_numeric_id_uses_upstream_original_course_lookup(monkeypatch):
    row = {"courseType": "shared", "courseId": "123", "recruitAndCourseId": ""}
    monkeypatch.setattr(legacy, "_current_course_row", lambda key: row)
    seen = []
    monkeypatch.setattr(legacy, "_run_bundled_zhs_args",
                        lambda args, token: seen.append(args) or 0)
    assert legacy.run_zhidao_original("a" * 64) == 0
    assert seen == [["play", "-c", "123", "--type", "zhidao"]]


def test_shared_course_missing_route_fails_before_launch(monkeypatch):
    monkeypatch.setattr(legacy, "_current_course_row",
                        lambda key: {"courseType": "shared", "courseId": "0"})
    monkeypatch.setattr(legacy, "_run_bundled_zhs_args",
                        lambda *args: pytest.fail("ZHS must not start without a valid course route"))
    assert legacy.run_zhidao_original("a" * 64) == 6


def test_stale_course_cannot_be_launched_with_previous_cache(monkeypatch, tmp_path):
    home = tmp_path / "home"
    data = home / ".zhs"
    data.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    cookies, salt = b"test-cookies", b"x" * 32
    (data / "cookies.json").write_bytes(cookies)
    (data / "zhidao-cache-salt.bin").write_bytes(salt)
    course = {"courseType": "shared", "courseId": "10", "stale": True}
    key = progress_key(course)
    cache = {
        "source": "zhidao", "schemaVersion": 4,
        "sessionFingerprint": hmac.new(salt, cookies, hashlib.sha256).hexdigest(),
        "courses": [course],
    }
    (data / "zhidao-courses.json").write_text(json.dumps(cache), encoding="utf-8")
    assert legacy.run_zhidao_original(key) == 6


def test_zhs_noninteractive_prompt_gets_distinct_exit_code(monkeypatch):
    import sys
    from types import ModuleType
    from importlib import metadata

    package, cli = ModuleType("zhs"), ModuleType("zhs.__main__")
    def needs_input(**_kwargs):
        raise EOFError("no stdin")
    cli.app = needs_input
    monkeypatch.setitem(sys.modules, "zhs", package)
    monkeypatch.setitem(sys.modules, "zhs.__main__", cli)
    monkeypatch.setattr(metadata, "version", lambda name: "0.1.5")
    assert legacy._run_bundled_zhs("20", "30") == 9
