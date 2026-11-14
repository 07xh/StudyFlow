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
    content = VENDOR.read_bytes()
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
        print("处理资源 1/2")
        print("\rplaying [=====] 75.0%", end="")
        path = tmp_path / "StudyFlow" / ("monitor-zhs-" + "b" * 32 + ".json")
        observed.append(json.loads(path.read_text(encoding="utf-8")))

    cli.app = app
    monkeypatch.setitem(sys.modules, "zhs", package)
    monkeypatch.setitem(sys.modules, "zhs.__main__", cli)
    monkeypatch.setattr(metadata, "version", lambda name: "0.1.5" if name == "zhs" else "0")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    original = io.StringIO()
    monkeypatch.setattr(sys, "stdout", original)

    assert legacy._run_bundled_zhs("20", "30", "b" * 32) == 0
    assert len(observed) == 1
    assert observed[0]["videoSegmentPercent"] == 75.0
    assert observed[0]["resourceIndex"] == 1
    assert "playing" in original.getvalue()
    assert not list((tmp_path / "StudyFlow").glob("monitor-zhs-*.json"))
    assert sys.stdout is original


def test_invalid_monitor_token_does_not_start_legacy_task(monkeypatch):
    monkeypatch.setattr(legacy, "_course_ids_for_current_session",
                        lambda _: (_ for _ in ()).throw(AssertionError("not called")))
    assert legacy.run_zhidao_original("a" * 64, "../../bad") == 2


def test_ui_status_cannot_be_conflated_with_server_progress():
    legacy_types = (ROOT / "frontend" / "src" / "legacyPlayback.ts").read_text(encoding="utf-8")
    panel = (ROOT / "frontend" / "src" / "components" / "LegacyPlaybackPanel.tsx").read_text(encoding="utf-8")
    rust = (ROOT / "src-tauri" / "src" / "legacy_tasks.rs").read_text(encoding="utf-8")
    assert "zhs_progress: ZhsLocalProgress | null" in legacy_types
    assert 'status.course_id === selection' in panel
    assert "本地模拟片段" in panel and "非服务器确认进度" in panel
    assert 'now - observed > 18.0' in rust
    assert "remove_zhs_snapshot(job.monitor_token.as_deref())" in rust
