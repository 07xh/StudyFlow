"""Candidate release metadata must describe the exact tested version."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def test_version_manifest_and_publish_workflow_agree():
    version = "0.1.1-rc.18"
    tauri = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    frontend = json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text(encoding="utf-8"))
    root = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert tauri["version"] == frontend["version"] == root["version"] == version
    assert lock["version"] == lock["packages"][""]["version"] == version
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    cargo = (ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8")
    workflow = (ROOT / ".github/workflows/build-windows.yml").read_text(encoding="utf-8")
    assert re.search(r'^version = "0\.1\.1rc18"$', pyproject, re.M)
    assert re.search(r'^version = "0\.1\.1-rc\.18"$', cargo, re.M)
    assert "gh release create v0.1.1-rc.18" in workflow
    assert "RELEASE_CANDIDATE_0.1.1_RC18.md" in workflow
    assert (ROOT / "docs/RELEASE_CANDIDATE_0.1.1_RC18.md").is_file()
