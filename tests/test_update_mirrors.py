"""Offline tests for mirror whitelisting, fallback, resume, and digest integrity."""
from __future__ import annotations

import hashlib
import io
from pathlib import Path
from urllib.error import URLError

import pytest

from studyflow.services import update_manager, update_sources, updater


class Response:
    def __init__(self, data: bytes, url: str, status: int = 200, content_range: str | None = None):
        self.data = io.BytesIO(data)
        self.url = url
        self.status = status
        self.content_range = content_range

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.data.close()

    def geturl(self):
        return self.url

    def getheader(self, name):
        return self.content_range if name == "Content-Range" else None

    def read(self, size=-1):
        return self.data.read(size)


GITHUB = "https://github.com/07xh/StudyFlow/releases/download/v0.2.0/StudyFlow_0.2.0_x64-setup.exe"
MIRROR = "https://sourceforge.net/projects/studyflow/files/releases/v0.2.0/StudyFlow_0.2.0_x64-setup.exe/download"


def test_mirror_paths_are_versioned_and_only_compiled_origin_is_used(monkeypatch):
    monkeypatch.setattr(update_sources, "_PROJECT", "studyflow")
    assert update_sources.sourceforge_project() == "studyflow"
    assert update_sources.sourceforge_download_url(GITHUB) == MIRROR
    assert update_sources.sourceforge_download_url("https://evil.example.org/setup.exe") is None
    assert update_sources.sourceforge_download_url(GITHUB.replace("v0.2.0", "../etc")) is None
    assert update_sources.source_order("auto", True, MIRROR) == ["sourceforge", "github"]
    assert update_sources.source_order("auto", False, MIRROR) == ["sourceforge"]
    assert update_sources.source_order("github", False, MIRROR) == ["github"]
    assert update_sources.source_order("sourceforge", True, None) == ["github"]
    monkeypatch.setattr(update_sources, "_PROJECT", "bad slug!")
    assert update_sources.sourceforge_project() == ""


def test_old_settings_are_preserved_and_migrated(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    root = tmp_path / "StudyFlow" / "updates"
    root.mkdir(parents=True)
    (root / "preferences.json").write_text('{"channel":"stable","mode":"notify"}')
    assert update_manager.preferences() == {
        "channel": "stable", "mode": "notify", "source": "auto", "fallback": True}
    assert update_manager.save_preferences({
        "channel": "stable", "mode": "notify", "source": "sourceforge", "fallback": False})["source"] == "sourceforge"
    with pytest.raises(ValueError):
        update_manager.save_preferences({
            "channel": "stable", "mode": "notify", "source": "sourceforge", "fallback": "false"})


def test_mirror_failure_falls_back_to_github_with_same_digest(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(update_sources, "_PROJECT", "studyflow")
    payload = b"verified installer bytes"
    digest = hashlib.sha256(payload).hexdigest()
    monkeypatch.setattr(updater, "release_info", lambda *args, **kwargs: {
        "version": "v0.2.0", "assets": [{
            "name": "StudyFlow_0.2.0_x64-setup.exe", "browser_download_url": GITHUB,
            "digest": "sha256:" + digest,
        }]})
    seen = []
    def download(url, checksum, destination, **kwargs):
        seen.append(url)
        if url == MIRROR:
            raise updater.UpdateError("UPDATE_DOWNLOAD_FAILED", "offline")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        return destination
    monkeypatch.setattr(updater, "verified_download", download)
    result = update_manager.download("0.1.0", "v0.2.0")
    assert result["source"] == "github"
    assert seen == [MIRROR, GITHUB]
    assert result["sha256"] == digest


def test_resumes_matching_206_range_then_verifies_sha256(monkeypatch, tmp_path):
    data = b"abcdef1234567890"
    sha = hashlib.sha256(data).hexdigest()
    target = tmp_path / "setup.exe"
    partial = target.with_name(target.name + "." + sha[:16] + ".part")
    partial.write_bytes(data[:5])
    requests = []
    def open_url(request, timeout):
        requests.append(request.headers.get("Range"))
        return Response(data[5:], "https://release-assets.githubusercontent.com/asset",
                        status=206, content_range="bytes 5-15/16")
    monkeypatch.setattr(updater, "urlopen", open_url)
    assert updater.verified_download(GITHUB, sha, target) == target
    assert requests == ["bytes=5-"]
    assert target.read_bytes() == data
    assert not partial.exists()


def test_server_ignoring_range_restarts_from_zero(monkeypatch, tmp_path):
    data = b"complete installer bytes"
    sha = hashlib.sha256(data).hexdigest()
    target = tmp_path / "setup.exe"
    partial = target.with_name(target.name + "." + sha[:16] + ".part")
    partial.write_bytes(b"stale")
    monkeypatch.setattr(updater, "urlopen",
                        lambda *_args, **_kwargs: Response(data, "https://release-assets.githubusercontent.com/asset"))
    updater.verified_download(GITHUB, sha, target)
    assert target.read_bytes() == data


def test_checksum_failure_removes_partial_and_does_not_publish(monkeypatch, tmp_path):
    target = tmp_path / "setup.exe"
    checksum = "a" * 64
    partial = target.with_name(target.name + "." + checksum[:16] + ".part")
    monkeypatch.setattr(updater, "urlopen",
                        lambda *_args, **_kwargs: Response(b"bad", "https://netix.dl.sourceforge.net/project/studyflow/file.exe"))
    with pytest.raises(updater.UpdateError) as caught:
        updater.verified_download(MIRROR, checksum, target, mirror_host="sourceforge.net")
    assert caught.value.code == "UPDATE_CHECKSUM_FAILED"
    assert not target.exists()
    assert not partial.exists()


def test_network_error_preserves_resumable_fragment(monkeypatch, tmp_path):
    target = tmp_path / "setup.exe"
    checksum = "b" * 64
    partial = target.with_name(target.name + "." + checksum[:16] + ".part")
    partial.write_bytes(b"part")
    monkeypatch.setattr(updater, "urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("offline")))
    with pytest.raises(updater.UpdateError) as caught:
        updater.verified_download(GITHUB, checksum, target)
    assert caught.value.code == "UPDATE_DOWNLOAD_FAILED"
    assert partial.read_bytes() == b"part"


def test_mirror_rejects_untrusted_redirect_even_if_digest_is_known(monkeypatch, tmp_path):
    target = tmp_path / "setup.exe"
    monkeypatch.setattr(updater, "urlopen", lambda *_args, **_kwargs:
                        Response(b"anything", "https://untrusted.example.org/installer"))
    with pytest.raises(updater.UpdateError) as caught:
        updater.verified_download(MIRROR, "a" * 64, target, mirror_host="sourceforge.net")
    assert caught.value.code == "UPDATE_REDIRECT_REJECTED"
    assert not target.exists()


def test_short_http_206_preserves_partial_for_next_attempt(monkeypatch, tmp_path):
    data = b"abcdefghijklmnop"
    sha = hashlib.sha256(data).hexdigest()
    target = tmp_path / "setup.exe"
    partial = target.with_name(target.name + "." + sha[:16] + ".part")
    partial.write_bytes(data[:5])
    monkeypatch.setattr(updater, "urlopen",
                        lambda *_args, **_kwargs: Response(data[5:8],
                            "https://release-assets.githubusercontent.com/asset",
                            status=206, content_range="bytes 5-15/16"))
    with pytest.raises(updater.UpdateError) as caught:
        updater.verified_download(GITHUB, sha, target)
    assert caught.value.code == "UPDATE_DOWNLOAD_FAILED"
    assert partial.read_bytes() == data[:8]
    assert not target.exists()
