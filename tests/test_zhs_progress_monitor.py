"""Read-only integration tests for the original, unchanged ZHS 0.1.5 observer."""
from __future__ import annotations

import hashlib
import io
import json
import runpy
import sys
import threading
import time
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



def test_parallel_ai_and_shared_progress_frames_use_separate_local_snapshots(tmp_path):
    from studyflow.services.zhs_resource_monitor import create_resource_monitor

    vendor = runpy.run_path(str(VENDOR), run_name="studyflow_zhs_test")
    first = create_resource_monitor(vendor["NumericTelemetry"], "a" * 32, tmp_path)
    second = create_resource_monitor(vendor["NumericTelemetry"], "b" * 32, tmp_path)
    ai_stdout = io.StringIO()
    shared_stdout = io.StringIO()
    ai = vendor["StdoutObserver"](ai_stdout, legacy._RefreshingZhsSink(first))
    shared = vendor["StdoutObserver"](shared_stdout, legacy._RefreshingZhsSink(second))

    # ZHS v0.1.5 uses distinct console progress layouts for AI and shared courses.
    ai.write("\rplaying [######----] 24.0%")
    shared.write("\rplaying 712")
    shared.write("345 [######----] 62.5%")
    first_data = json.loads(first.path.read_text(encoding="utf-8"))
    second_data = json.loads(second.path.read_text(encoding="utf-8"))
    assert first_data["token"] == "a" * 32
    assert second_data["token"] == "b" * 32
    assert first_data["videoSegmentPercent"] == 24.0
    assert second_data["videoSegmentPercent"] == 62.5
    assert "24.0%" in ai_stdout.getvalue()
    assert "62.5%" in shared_stdout.getvalue()

    # Only real, valid console bar data may change each independently scoped file.
    shared.write("\rplaying 712345 [######----] 120.0%")
    shared.write("\rlogin diagnostic: 99.0%")
    assert json.loads(second.path.read_text(encoding="utf-8"))["videoSegmentPercent"] == 62.5
    ai.write("\rplaying [########--] 80.0%")
    assert json.loads(first.path.read_text(encoding="utf-8"))["videoSegmentPercent"] == 80.0
    assert json.loads(second.path.read_text(encoding="utf-8"))["videoSegmentPercent"] == 62.5


def test_shared_output_preserves_resource_boundary_and_ignores_non_video_numbers(tmp_path):
    from studyflow.services.zhs_resource_monitor import create_resource_monitor

    vendor = runpy.run_path(str(VENDOR), run_name="studyflow_zhs_test")
    monitor = create_resource_monitor(vendor["NumericTelemetry"], "c" * 32, tmp_path)
    observer = vendor["StdoutObserver"](io.StringIO(), legacy._RefreshingZhsSink(monitor))
    monitor.mark_resource("video", "章节视频")
    observer.write("\rplaying 125 [########--] 81.0%")
    assert json.loads(monitor.path.read_text(encoding="utf-8"))["videoSegmentPercent"] == 81.0
    monitor.mark_resource("video", "下一段视频")
    record = json.loads(monitor.path.read_text(encoding="utf-8"))
    assert record["videoSegmentPercent"] is None
    assert record["resourceName"] == "下一段视频"

    observer.write("\ranswering [####] 90.0%")
    observer.write("\rpause [####] 40.0%")
    observer.write("\rplaying nope [####] 75.0%")
    assert json.loads(monitor.path.read_text(encoding="utf-8"))["videoSegmentPercent"] is None
    observer.write("\rplaying 126 [##] 13.0%")
    assert json.loads(monitor.path.read_text(encoding="utf-8"))["videoSegmentPercent"] == 13.0

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



def test_shared_zhs_observer_serializes_stdout_stderr():
    """A single telemetry sink is shared by both streams and may be called concurrently."""
    entered = threading.Event()
    release = threading.Event()
    attempted = threading.Event()
    calls = []

    class BlockingNumericSink:
        last_snapshot = None

        def receive(self, chunk: str) -> None:
            calls.append(chunk)
            if chunk == "stderr":
                entered.set()
                if not release.wait(timeout=3):
                    raise AssertionError("first observer call timed out")
            self.last_snapshot = (chunk,)

    observer = legacy._RefreshingZhsSink(BlockingNumericSink())
    first = threading.Thread(target=observer.receive, args=("stderr",), daemon=True)

    def second_stream():
        attempted.set()
        observer.receive("stdout")

    second = threading.Thread(target=second_stream, daemon=True)
    first.start()
    try:
        assert entered.wait(timeout=2)
        second.start()
        assert attempted.wait(timeout=2)
        # The second stream must not enter the same mutable sink while the
        # first is still processing; otherwise snapshots can race.
        time.sleep(0.03)
        assert calls == ["stderr"]
    finally:
        release.set()
        first.join(timeout=2)
        if second.ident is not None:
            second.join(timeout=2)
    assert not first.is_alive() and not second.is_alive()
    assert calls == ["stderr", "stdout"]
    assert observer.disabled is False


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
    assert "当前视频片段位置" in panel and "非服务器确认进度" in panel
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
    stop = rust.split("fn legacy_stop_blocking", 1)[1].split("#[cfg(test)]", 1)[0]
    assert 'Err("TASK_RUN_CHANGED".into())' in stop


def test_monitor_remains_a_read_only_observer():
    # Keep the original vendor and upstream sender byte-for-byte untouched.
    wrapper = (ROOT / "src" / "studyflow" / "services" / "legacy_playback.py").read_text(encoding="utf-8")
    assert 'zhs_app(args=arguments, standalone_mode=False)' in wrapper
    assert 'monitor_token' in wrapper
    assert 'sys.stdout = original_stdout' in wrapper


def test_local_snapshot_reader_rejects_symlink_metadata():
    rust = (ROOT / "src-tauri" / "src" / "legacy_tasks.rs").read_text(encoding="utf-8")
    assert "fs::symlink_metadata(&path)" in rust
    assert "if !metadata.is_file()" in rust


def test_repeated_shared_video_sample_renews_freshness_without_new_percent(monkeypatch, tmp_path):
    from studyflow.services import zhs_resource_monitor as resource_monitor

    vendor = runpy.run_path(str(VENDOR), run_name="studyflow_zhs_test")
    monitor = resource_monitor.create_resource_monitor(
        vendor["NumericTelemetry"], "e" * 32, tmp_path
    )
    clock = [100.0]
    monkeypatch.setattr(legacy.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resource_monitor.time, "time", lambda: clock[0])
    sink = legacy._RefreshingZhsSink(monitor)

    sink.receive("playing 123456 [####------] 40.0%")
    assert json.loads(monitor.path.read_text(encoding="utf-8"))["at"] == 100.0
    clock[0] = 106.0
    sink.receive("playing 123456 [####------] 40.0%")
    unchanged = json.loads(monitor.path.read_text(encoding="utf-8"))
    assert unchanged["videoSegmentPercent"] == 40.0
    assert unchanged["at"] == 106.0

    clock[0] = 112.0
    sink.receive("unrelated diagnostic 80.0%")
    assert json.loads(monitor.path.read_text(encoding="utf-8"))["at"] == 106.0
