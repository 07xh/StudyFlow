"""Tests for update discovery and verified downloads; no network access."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from studyflow.services import updater


class FakeResponse:
    def __init__(self, data: bytes, url: str):
        self.stream = io.BytesIO(data)
        self.url = url

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, n: int = -1) -> bytes:
        return self.stream.read(n)

    def geturl(self) -> str:
        return self.url


def test_release_filters_prereleases_and_drafts():
    releases = [
        {"tag_name": "v9.0.0", "draft": True},
        {"tag_name": "v2.0.0-beta.1", "prerelease": True},
        {"tag_name": "v1.2.0", "prerelease": False, "draft": False, "assets": [], "html_url": "https://github.com/07xh/StudyFlow/releases/tag/v1.2.0"},
    ]
    with patch.object(updater, "urlopen", return_value=FakeResponse(json.dumps(releases).encode(), "https://api.github.com/repos/07xh/StudyFlow/releases")):
        info = updater.release_info("1.0.0", channel="beta")
    assert info and info["version"] == "v2.0.0-beta.1"

    stable = {"tag_name": "v1.2.0", "draft": False, "prerelease": False}
    with patch.object(updater, "urlopen", return_value=FakeResponse(json.dumps(stable).encode(), "https://api.github.com/repos/07xh/StudyFlow/releases/latest")):
        assert updater.release_info("v1.2.0", channel="stable") is None


def test_download_validates_digest_without_execution(tmp_path: Path):
    data = b"StudyFlow test payload only, not an installer"
    url = "https://github.com/07xh/StudyFlow/releases/download/v1.0.0/studyflow.exe"
    redirect = "https://release-assets.githubusercontent.com/objects/expected"
    target = tmp_path / "verified.exe"
    with patch.object(updater, "urlopen", return_value=FakeResponse(data, redirect)):
        assert updater.verified_download(url, hashlib.sha256(data).hexdigest(), target) == target
    assert target.read_bytes() == data


def test_download_rejects_wrong_checksum_without_writing_target(tmp_path: Path):
    url = "https://github.com/07xh/StudyFlow/releases/download/v1.0.0/studyflow.exe"
    target = tmp_path / "verified.exe"
    with patch.object(updater, "urlopen", return_value=FakeResponse(b"unexpected", "https://release-assets.githubusercontent.com/asset")):
        with pytest.raises(ValueError, match="checksum"):
            updater.verified_download(url, "a" * 64, target)
    assert not target.exists()


def test_download_rejects_external_redirect(tmp_path: Path):
    url = "https://github.com/07xh/StudyFlow/releases/download/v1.0.0/studyflow.exe"
    target = tmp_path / "verified.exe"
    with patch.object(updater, "urlopen", return_value=FakeResponse(b"anything", "https://example.com/evil.exe")):
        with pytest.raises(ValueError, match="redirect"):
            updater.verified_download(url, "a" * 64, target)
    assert not target.exists()
