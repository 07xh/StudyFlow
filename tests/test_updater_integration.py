"""Tests for update discovery and verified downloads; no network access."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from urllib.error import HTTPError
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


def test_checksum_failure_has_safe_code_and_never_installs(tmp_path: Path):
    url = "https://github.com/07xh/StudyFlow/releases/download/v1.0.0/studyflow.exe"
    target = tmp_path / "verified.exe"
    with patch.object(updater, "urlopen",
                      return_value=FakeResponse(b"unexpected", "https://release-assets.githubusercontent.com/asset")):
        with pytest.raises(updater.UpdateError) as error:
            updater.verified_download(url, "a" * 64, target)
    assert error.value.code == "UPDATE_CHECKSUM_FAILED"
    assert not target.exists()
    assert not any(tmp_path.iterdir())


def test_update_api_network_failure_has_stable_code():
    from urllib.error import URLError
    with patch.object(updater, "urlopen", side_effect=URLError("Private URL detail")):
        with pytest.raises(updater.UpdateError) as error:
            updater.release_info("0.1.0", channel="beta")
    assert error.value.code == "UPDATE_NETWORK_FAILED"


def test_invalid_release_metadata_has_safe_code():
    with patch.object(updater, "urlopen",
                      return_value=FakeResponse(b'{"invalid": true}', updater.API)):
        assert updater.release_info("0.1.0", channel="beta") is None
    with patch.object(updater, "urlopen",
                      return_value=FakeResponse(b'{"broken": ', updater.API)):
        with pytest.raises(updater.UpdateError) as error:
            updater.release_info("0.1.0", channel="beta")
    assert error.value.code == "UPDATE_RELEASE_INVALID"



@pytest.mark.parametrize("status,headers,expected", [
    (403, {}, "UPDATE_NETWORK_FAILED"),
    (403, {"X-RateLimit-Remaining": "0"}, "UPDATE_RATE_LIMITED"),
    (403, {"Retry-After": "60"}, "UPDATE_RATE_LIMITED"),
    (429, {}, "UPDATE_RATE_LIMITED"),
    (503, {}, "UPDATE_NETWORK_FAILED"),
])
def test_release_http_error_does_not_mislabel_all_403s_as_rate_limit(status, headers, expected):
    failure = HTTPError(updater.API, status, "test", headers, None)
    with patch.object(updater, "urlopen", side_effect=failure):
        with pytest.raises(updater.UpdateError) as caught:
            updater.release_info("0.1.1-rc.13", channel="beta")
    assert caught.value.code == expected


@pytest.mark.parametrize("headers,expected", [
    ({}, "UPDATE_DOWNLOAD_FAILED"),
    ({"X-RateLimit-Remaining": "0"}, "UPDATE_RATE_LIMITED"),
])
def test_download_403_has_specific_error(headers, expected, tmp_path):
    failure = HTTPError("https://github.com/07xh/StudyFlow/releases/download/v0.2.0/app.exe",
                        403, "test", headers, None)
    with patch.object(updater, "urlopen", side_effect=failure):
        with pytest.raises(updater.UpdateError) as caught:
            updater.verified_download(
                "https://github.com/07xh/StudyFlow/releases/download/v0.2.0/app.exe",
                "a" * 64, tmp_path / "untrusted.exe")
    assert caught.value.code == expected
    assert not list(tmp_path.iterdir())
