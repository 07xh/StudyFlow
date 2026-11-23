"""Build input contracts: one Python manifest and deterministic frontend installs."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_obsolete_duplicate_packaging_manifest_is_not_used():
    # The installer installs '.[desktop,dev]' from pyproject.toml, not a
    # divergent packaging/requirements.txt that misses active dependencies.
    assert (ROOT / "pyproject.toml").is_file()
    assert not (ROOT / "packaging/requirements.txt").exists()
    script = (ROOT / "scripts/build-windows.ps1").read_text(encoding="utf-8")
    assert "pip install -e '.[desktop,dev]'" in script
    assert "pip install -r" not in script


def test_frontend_lockfile_is_aligned_with_manifest_and_all_build_gates():
    package = json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text(encoding="utf-8"))
    assert lock["lockfileVersion"] >= 2
    assert package["version"] == lock["version"] == lock["packages"][""]["version"]
    assert package["dependencies"] == lock["packages"][""]["dependencies"]
    assert package["devDependencies"] == lock["packages"][""]["devDependencies"]

    windows = (ROOT / "scripts/build-windows.ps1").read_text(encoding="utf-8")
    validation = (ROOT / ".github/workflows/test.yml").read_text(encoding="utf-8")
    release = (ROOT / ".github/workflows/build-windows.yml").read_text(encoding="utf-8")
    assert "npm ci --prefix frontend --no-audit --no-fund" in windows
    assert "npm ci --no-audit --no-fund" in validation
    assert "npm ci --prefix frontend --no-audit --no-fund" in release

def test_playwright_browser_cache_tracks_the_pinned_smoke_dependency():
    workflow = (ROOT / ".github/workflows/test.yml").read_text(encoding="utf-8")
    assert "playwright@1.62.1" in workflow
    assert "key: studyflow-playwright-chromium-${{ runner.os }}-1.62.1" in workflow
    assert "path: ~/.cache/ms-playwright" in workflow
    assert "playwright\" install --with-deps chromium" in workflow
