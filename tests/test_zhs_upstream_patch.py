"""Offline invariants for the isolated ZHS 0.1.5 reliability overlay."""
from pathlib import Path

import pytest

from studyflow.services.zhs_upstream_patch import (
    MARKER, PATCH_ID, UPSTREAM_GIT_BLOBS, UnsupportedUpstream,
    check, git_blob_sha, once, transform,
)

ROOT = Path(__file__).resolve().parents[1]


def test_reviewed_sources_are_pinned_and_only_four_modules_are_touched():
    assert set(UPSTREAM_GIT_BLOBS) == {
        "ai/video.py", "ai/course.py", "hike/video.py", "zhidao/video.py"
    }
    assert all(len(sha) == 40 for sha in UPSTREAM_GIT_BLOBS.values())
    assert PATCH_ID.startswith("studyflow-zhs-reliability-")


def test_unknown_or_changed_source_fails_closed():
    with pytest.raises(UnsupportedUpstream, match="Unexpected ZHS path"):
        transform("api/http_client.py", "pass\n")
    with pytest.raises(UnsupportedUpstream, match="differs from reviewed tag"):
        transform("ai/video.py", "pass\n")
    with pytest.raises(UnsupportedUpstream, match="expected 1"):
        once("x", "y", "z", "test")
    with pytest.raises(UnsupportedUpstream, match="found 2"):
        once("abc abc", "abc", "xyz", "test")


def test_git_blob_normalizes_windows_line_endings():
    assert git_blob_sha("line1\nline2\n") == git_blob_sha("line1\r\nline2\r\n")


def test_staging_check_requires_all_four_valid_source_files(tmp_path):
    stage = tmp_path / "zhs-stage"
    for name in UPSTREAM_GIT_BLOBS:
        file = stage / "zhs" / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("pass\n\n" + MARKER + "\n", encoding="utf-8")
    check(stage)
    (stage / "zhs" / "ai" / "video.py").write_text("pass\n", encoding="utf-8")
    with pytest.raises(UnsupportedUpstream, match="Patch marker missing"):
        check(stage)


def test_build_uses_isolated_patch_and_frozen_runtime_checks_marker():
    builder = (ROOT / "scripts" / "build-sidecar.ps1").read_text(encoding="utf-8")
    entry = (ROOT / "packaging" / "bridge_entry.py").read_text(encoding="utf-8")
    assert "zhs_upstream_patch prepare $stage" in builder
    assert "python -m PyInstaller @flags" in builder
    assert "previousPythonPath" in builder
    assert "STUDYFLOW_ZHS_RELIABILITY_PATCH" in entry
    assert "ZHS 0.1.5 patched reliability runtime" in entry


def test_overlay_keeps_protocol_outside_patch_scope():
    source = (ROOT / "src" / "studyflow" / "services" / "zhs_upstream_patch.py").read_text(encoding="utf-8")
    assert "saveDatabaseIntervalTimeV2" not in source
    assert "studyRecord/report" not in source
    assert "studyTotalTime" not in source
    assert "write_text(text, encoding=\"utf-8\", newline=\"\\n\")" in source
