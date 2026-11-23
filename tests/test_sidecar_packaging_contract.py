"""Keep development-only packages out of the frozen Windows sidecar."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_windows_sidecar_excludes_test_only_dependencies():
    build = (ROOT / "scripts" / "build-sidecar.ps1").read_text(encoding="utf-8")
    # The installer runs its tests before freezing the app; test helpers must
    # not be bundled in the executable together with live credential backends.
    assert "'--exclude-module','keyring.testing'" in build
    assert "'--exclude-module','pytest'" in build
    assert "'--collect-all','keyring'" in build
    assert "'--collect-all','zhs'" in build


def test_packaging_still_verifies_original_platform_runtimes():
    build = (ROOT / "scripts" / "build-sidecar.ps1").read_text(encoding="utf-8")
    assert "--zhidao-env-check" in build
    assert "--yuketang-env-check" in build
    assert "--ucampus-socket-env-check" in build
