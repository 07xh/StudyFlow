"""Guard every imported original file against accidental rewrites.

The manifest lists Git blob SHAs from the original projects, not byte
checksums inferred from a Windows CRLF checkout.
"""
import json
from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "docs" / "ORIGINAL_SOURCE_MANIFEST.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("path,sha", sorted(MANIFEST["blobs"].items()))
def test_original_git_blobs_remain_identical(path: str, sha: str):
    assert (ROOT / path).is_file(), path
    result = subprocess.run(
        ["git", "rev-parse", f"HEAD:{path}"],
        cwd=ROOT, capture_output=True, text=True, check=True, timeout=10,
    )
    assert result.stdout.strip() == sha, path
    subprocess.run(
        ["git", "diff", "--exit-code", "--quiet", "HEAD", "--", path],
        cwd=ROOT, capture_output=True, text=True, check=True, timeout=10,
    )


def test_snapshot_has_both_original_repositories():
    revisions = MANIFEST["source_revisions"]
    assert set(revisions) == {"zhidao", "yuketang"}
    assert len(MANIFEST["blobs"]) >= 47
    assert any(k.endswith("legacy/yuketang/exe_entry.py") for k in MANIFEST["blobs"])
    assert any(k.endswith("legacy/zhidao/CookieImport.ps1") for k in MANIFEST["blobs"])
