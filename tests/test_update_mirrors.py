"""Public proxy URL restrictions, fallback and HTTP resumable-download regression tests."""
from __future__ import annotations

import hashlib
import io
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
P1 = "https://gh-proxy.org/" + GITHUB
P2 = "https://ghfast.top/" + GITHUB


def test_public_proxies_only_accept_official_release_assets():
    assert update_sources.proxy_url(GITHUB, "gh-proxy.org") == P1
    assert update_sources.proxy_url(GITHUB, "ghfast.top") == P2
    assert not update_sources.trusted_release_url(GITHUB + "?token=secret")
    for bad in (
        "https://evil.example.org/setup.exe",
        "https://github.com/07xh/Other/releases/download/v0.2.0/file.exe",
        GITHUB.replace("v0.2.0", "../bad"),
        GITHUB.replace("github.com", "github.com.attacker.org"),
    ):
        with pytest.raises(ValueError):
            update_sources.proxy_url(bad, "ghfast.top")
    with pytest.raises(ValueError):
        update_sources.proxy_url(GITHUB, "untrusted.example.org")
    assert update_sources.source_order("auto", True) == ["gh-proxy.org", "ghfast.top", "github"]
    assert update_sources.source_order("proxy", False) == ["gh-proxy.org", "ghfast.top"]
    assert update_sources.source_order("github", False) == ["github"]
    assert update_sources.source_order("gh-proxy.org", False) == ["gh-proxy.org"]
    assert update_sources.source_order("ghfast.top", False) == ["ghfast.top"]
    assert update_sources.source_order("ghfast.top", True) == ["ghfast.top", "gh-proxy.org", "github"]
    assert update_sources.source_order("gh-proxy.org", True) == ["gh-proxy.org", "ghfast.top", "github"]
    with pytest.raises(ValueError):
        update_sources.source_order("evil.example.org", True)
    with pytest.raises(ValueError):
        update_sources.source_order("gh-proxy.org", "yes")


def test_old_settings_migrate_and_invalid_proxy_choices_rejected(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    root = tmp_path / "StudyFlow" / "updates"
    root.mkdir(parents=True)
    (root / "preferences.json").write_text('{"channel":"stable","mode":"notify"}')
    assert update_manager.preferences() == {
        "channel": "stable", "mode": "notify", "source": "auto", "fallback": True}
    (root / "preferences.json").write_text(
        '{"channel":"stable","mode":"notify","source":"sourceforge","fallback":true}')
    assert update_manager.preferences()["source"] == "auto"
    saved = update_manager.save_preferences({
        "channel": "stable", "mode": "notify", "source": "proxy", "fallback": False})
    assert saved["source"] == "proxy"
    saved = update_manager.save_preferences({
        "channel": "stable", "mode": "notify", "source": "ghfast.top", "fallback": False})
    assert saved["source"] == "ghfast.top"
    assert update_manager.preferences() == saved
    with pytest.raises(ValueError):
        update_manager.save_preferences({
            "channel": "stable", "mode": "notify", "source": "not-an-approved-proxy", "fallback": True})
    with pytest.raises(ValueError):
        update_manager.save_preferences({
            "channel": "stable", "mode": "notify", "source": "proxy", "fallback": "false"})


def test_proxy_rotation_and_official_fallback_share_github_digest(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
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
        assert checksum == digest
        if url != GITHUB:
            raise updater.UpdateError("UPDATE_DOWNLOAD_FAILED", "offline")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        return destination

    monkeypatch.setattr(updater, "verified_download", download)
    result = update_manager.download("0.1.0", "v0.2.0")
    assert result["source"] == "github"
    assert seen == [P1, P2, GITHUB]
    assert result["sha256"] == digest


def test_selected_single_proxy_does_not_try_other_sources(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    payload = b"verified installer bytes"
    digest = hashlib.sha256(payload).hexdigest()
    monkeypatch.setattr(updater, "release_info", lambda *args, **kwargs: {
        "version": "v0.2.0", "assets": [{
            "name": "StudyFlow_0.2.0_x64-setup.exe", "browser_download_url": GITHUB,
            "digest": "sha256:" + digest,
        }]})
    update_manager.save_preferences({
        "channel": "beta", "mode": "download", "source": "ghfast.top", "fallback": False})
    seen = []

    def download(url, checksum, destination, **kwargs):
        seen.append(url)
        assert checksum == digest
        raise updater.UpdateError("UPDATE_DOWNLOAD_FAILED", "offline")

    monkeypatch.setattr(updater, "verified_download", download)
    with pytest.raises(updater.UpdateError):
        update_manager.download("0.1.0", "v0.2.0")
    assert seen == [P2]


def test_selected_single_proxy_fails_over_in_order(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    payload = b"verified installer bytes"
    digest = hashlib.sha256(payload).hexdigest()
    monkeypatch.setattr(updater, "release_info", lambda *args, **kwargs: {
        "version": "v0.2.0", "assets": [{
            "name": "StudyFlow_0.2.0_x64-setup.exe", "browser_download_url": GITHUB,
            "digest": "sha256:" + digest,
        }]})
    update_manager.save_preferences({
        "channel": "beta", "mode": "download", "source": "ghfast.top", "fallback": True})
    seen = []

    def download(url, checksum, destination, **kwargs):
        seen.append(url)
        if url != P1:
            raise updater.UpdateError("UPDATE_DOWNLOAD_FAILED", "offline")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        return destination

    monkeypatch.setattr(updater, "verified_download", download)
    result = update_manager.download("0.1.0", "v0.2.0")
    assert seen == [P2, P1]
    assert result["source"] == "gh-proxy.org"
    assert result["sha256"] == digest


def test_proxy_response_valid_digest_is_accepted(monkeypatch, tmp_path):
    data = b"verified installer fixture"
    target = tmp_path / "setup.exe"
    checksum = hashlib.sha256(data).hexdigest()
    monkeypatch.setattr(updater, "urlopen",
                        lambda *_args, **_kwargs: Response(data, P1))
    assert updater.verified_download(P1, checksum, target, mirror_host="gh-proxy.org") == target
    assert target.read_bytes() == data


def test_proxy_checksum_failure_never_publishes(monkeypatch, tmp_path):
    target = tmp_path / "setup.exe"
    checksum = "a" * 64
    partial = target.with_name(target.name + "." + checksum[:16] + ".part")
    monkeypatch.setattr(updater, "urlopen",
                        lambda *_args, **_kwargs: Response(b"<html>error page</html>", P2))
    with pytest.raises(updater.UpdateError) as caught:
        updater.verified_download(P2, checksum, target, mirror_host="ghfast.top")
    assert caught.value.code == "UPDATE_CHECKSUM_FAILED"
    assert not target.exists()
    assert not partial.exists()


def test_proxy_rejects_unapproved_redirect(monkeypatch, tmp_path):
    target = tmp_path / "setup.exe"
    monkeypatch.setattr(updater, "urlopen",
                        lambda *_args, **_kwargs: Response(b"wrong bytes", "https://evil.example.org/file.exe"))
    with pytest.raises(updater.UpdateError) as caught:
        updater.verified_download(P1, "a" * 64, target, mirror_host="gh-proxy.org")
    assert caught.value.code == "UPDATE_REDIRECT_REJECTED"
    assert not target.exists()


def test_206_resume_with_correct_content_range(monkeypatch, tmp_path):
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
    updater.verified_download(GITHUB, sha, target)
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


def test_network_error_preserves_partial_for_resume(monkeypatch, tmp_path):
    target = tmp_path / "setup.exe"
    checksum = "b" * 64
    partial = target.with_name(target.name + "." + checksum[:16] + ".part")
    partial.write_bytes(b"part")
    monkeypatch.setattr(updater, "urlopen",
                        lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("offline")))
    with pytest.raises(updater.UpdateError) as caught:
        updater.verified_download(GITHUB, checksum, target)
    assert caught.value.code == "UPDATE_DOWNLOAD_FAILED"
    assert partial.read_bytes() == b"part"


def test_short_http_206_keeps_fragment_for_retry(monkeypatch, tmp_path):
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
