"""Read-only integration tests for the original, unchanged ZHS 0.1.5 observer."""
from __future__ import annotations

import hashlib
import io
import json
import runpy
import sys
from pathlib import Path
from types import ModuleType

from studyflow.services import legacy_playback as legacy

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "legacy" / "zhidao" / "ZHS-ConsoleMonitor.py"


def test_original_observer_is_bit_for_bit_upstream():
    # Windows git autocrlf can expand line endings in the working tree;
    # compare normalized Git blob bytes, not platform-specific checkout bytes.
    content = VENDOR.read_bytes().replace(b"\r\n", b"\n")
    blob = b"blob " + str(len(content)).encode() + b"\x00" + content
    assert hashlib.sha1(blob).hexdigest() == "fbff5bce350245ddf4dfde42ea8a18db944ff307"


def test_numeric_observer_keeps_local_segment_and_resource_position_separate(tmp_path):
    vendor = runpy.run_path(str(VENDOR), run_name="studyflow_zhs_test")
    sink = vendor["NumericTelemetry"]("a" * 32, directory=tmp_path)
    output = io.StringIO()
    tee = vendor["StdoutObserver"](output, sink)

    tee.write("处理资源 2/5")
    tee.write("\n")
    tee.write("\rplaying [####------] 48.5%")
    data = json.loads(sink.path.read_text(encoding="utf-8"))
    assert data["videoSegmentPercent"] == 48.5
    assert data["resourceIndex"] == 2
    assert data["resourceTotal"] == 5
    assert "playing" in output.getvalue()
    tee.write("\r处理资源 3/5")
    tee.write("\n")
    next_data = json.loads(sink.path.read_text(encoding="utf-8"))
    assert next_data["videoSegmentPercent"] is None
    assert next_data["resourceIndex"] == 3

    tee.write("\rplaying [####] 200.0%")
    assert json.loads(sink.path.read_text(encoding="utf-8")) == next_data


def test_original_cli_still_runs_unpatched_while_local_snapshot_is_collected(monkeypatch, tmp_path):
    from importlib import metadata

    package = ModuleType("zhs")
    cli = ModuleType("zhs.__main__")
    observed = []

    def app(*, args, standalone_mode):
        assert args == ["play", "-c", "20:30", "--type", "ai"]
        assert standalone_mode is False
        print("处理资源 1/2", file=sys.stderr)
        print("\rplaying [=====] 75.0%", end="")
        path = tmp_path / "StudyFlow" / ("monitor-zhs-" + "b" * 32 + ".json")
        observed.append(json.loads(path.read_text(encoding="utf-8")))

    cli.app = app
    monkeypatch.setitem(sys.modules, "zhs", package)
    monkeypatch.setitem(sys.modules, "zhs.__main__", cli)
    monkeypatch.setattr(metadata, "version", lambda name: "0.1.5" if name == "zhs" else "0")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    original = io.StringIO()
    original_stderr = io.StringIO()
    monkeypatch.setattr(sys, "stdout", original)
    monkeypatch.setattr(sys, "stderr", original_stderr)

    assert legacy._run_bundled_zhs("20", "30", "b" * 32) == 0
    assert len(observed) == 1
    assert observed[0]["videoSegmentPercent"] == 75.0
    assert observed[0]["resourceIndex"] == 1
    assert "playing" in original.getvalue()
    assert "处理资源 1/2" in original_stderr.getvalue()
    # The supervisor, not the worker, owns terminal telemetry cleanup.
    snapshots = list((tmp_path / "StudyFlow").glob("monitor-zhs-*.json"))
    assert len(snapshots) == 1
    assert json.loads(snapshots[0].read_text(encoding="utf-8"))["videoSegmentPercent"] == 75.0
    snapshots[0].unlink()
    assert sys.stdout is original
    assert sys.stderr is original_stderr


def test_repeated_original_progress_output_refreshes_local_observation(monkeypatch, tmp_path):
    vendor = runpy.run_path(str(VENDOR), run_name="studyflow_zhs_test")
    raw = vendor["NumericTelemetry"]("d" * 32, directory=tmp_path)
    clock = [100.0]
    monkeypatch.setattr(legacy.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(legacy.time, "time", lambda: clock[0])
    sink = legacy._RefreshingZhsSink(raw)

    sink.receive("playing [====] 50.0%")
    assert json.loads(raw.path.read_text(encoding="utf-8"))["at"] == 100.0

    clock[0] = 104.0
    sink.receive("playing [====] 50.0%")
    assert json.loads(raw.path.read_text(encoding="utf-8"))["at"] == 100.0

    clock[0] = 105.0
    sink.receive("ordinary CLI diagnostic without numeric progress")
    assert json.loads(raw.path.read_text(encoding="utf-8"))["at"] == 100.0
    assert raw.last_snapshot == (50.0, None, None)

    clock[0] = 106.0
    sink.receive("playing [====] 50.0%")
    assert json.loads(raw.path.read_text(encoding="utf-8"))["at"] == 106.0


def test_numeric_observer_fails_open_for_original_cli_on_snapshot_io_error(monkeypatch, tmp_path):
    vendor = runpy.run_path(str(VENDOR), run_name="studyflow_zhs_test")
    raw = vendor["NumericTelemetry"]("f" * 32, directory=tmp_path)
    calls = []

    def blocked_write():
        calls.append(True)
        raise OSError("mock filesystem denied")

    monkeypatch.setattr(raw, "publish", blocked_write)
    wrapped = legacy._RefreshingZhsSink(raw)
    destination = io.StringIO()
    tee = vendor["StdoutObserver"](destination, wrapped)

    assert tee.write("playing [======] 60.0%") > 0
    assert "60.0%" in destination.getvalue()
    assert wrapped.disabled is True
    assert len(calls) == 1
    assert not raw.path.exists()

    # Further CLI writes must still pass through without repeated file IO.
    tee.write("\nplaying [=======] 70.0%")
    assert "70.0%" in destination.getvalue()
    assert len(calls) == 1
    assert raw.last_snapshot is None


def test_invalid_monitor_token_does_not_start_legacy_task(monkeypatch):
    monkeypatch.setattr(legacy, "_course_ids_for_current_session",
                        lambda _: (_ for _ in ()).throw(AssertionError("not called")))
    assert legacy.run_zhidao_original("a" * 64, "../../bad") == 2


def test_ui_status_cannot_be_conflated_with_server_progress():
    legacy_types = (ROOT / "frontend" / "src" / "legacyPlayback.ts").read_text(encoding="utf-8")
    panel = (ROOT / "frontend" / "src" / "components" / "LegacyPlaybackPanel.tsx").read_text(encoding="utf-8")
    rust = (ROOT / "src-tauri" / "src" / "legacy_tasks.rs").read_text(encoding="utf-8")
    assert "zhs_progress: ZhsLocalProgress | null" in legacy_types
    assert 'status?.course_id === selection' in panel
    assert "本地模拟片段" in panel and "非服务器确认进度" in panel
    assert 'now - observed > 18.0' in rust
    assert "remove_zhs_snapshot(job.monitor_token.as_deref())" in rust
    assert "last_zhs_progress" in rust
    assert "fresh_zhs_progress" in rust and "zhs_stale" in rust
    assert "status.zhs_stale" in panel
    status = rust.split("fn status_of", 1)[1].split("fn terminate_tree", 1)[0]
    assert status.index("child.try_wait()") < status.index("read_zhs_snapshot")
    assert status.index("read_zhs_snapshot") < status.index("remove_zhs_snapshot")
    assert "结束前最后一次真实采样" in panel


def test_rust_idle_status_always_initializes_telemetry_freshness():
    rust = (ROOT / "src-tauri" / "src" / "legacy_tasks.rs").read_text(encoding="utf-8")
    # Status queries return idle; stop without a recorded run rejects the
    # request instead of manufacturing a successful idle response.
    idle_statuses = [
        line.strip() for line in rust.splitlines()
        if 'Ok(LegacyStatus {platform, state: "idle"' in line
    ]
    assert len(idle_statuses) == 1
    assert all("zhs_stale: false" in line for line in idle_statuses)
    stop = rust.split("pub fn legacy_stop", 1)[1].split("#[cfg(test)]", 1)[0]
    assert 'Err("TASK_RUN_CHANGED".into())' in stop


def test_monitor_remains_a_read_only_observer():
    # Keep the original vendor and upstream sender byte-for-byte untouched.
    wrapper = (ROOT / "src" / "studyflow" / "services" / "legacy_playback.py").read_text(encoding="utf-8")
    assert 'zhs_app(args=arguments, standalone_mode=False)' in wrapper
    assert 'monitor_token' in wrapper
    assert 'sys.stdout = original_stdout' in wrapper
