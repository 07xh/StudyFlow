import hashlib
from urllib.error import HTTPError

import pytest
from studyflow.services import updater


def test_first_release_404_means_no_update(monkeypatch):
    def missing(*args, **kwargs):
        raise HTTPError(updater.API + '/latest', 404, 'Not Found', {}, None)
    monkeypatch.setattr(updater, 'urlopen', missing)
    assert updater.release_info('0.1.0') is None


def test_stable_replaces_same_version_beta_and_beta_numbers_sort_numerically():
    assert updater.is_newer('v0.1.0', '0.1.0-beta.2')
    assert updater.is_newer('0.1.0-beta.10', '0.1.0-beta.2')
    assert not updater.is_newer('0.1.0-beta.2', '0.1.0')


def test_update_preferences_and_verified_download_use_only_app_directory(monkeypatch, tmp_path):
    from studyflow.services import update_manager as manager
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path))
    assert manager.preferences() == {'channel': 'beta', 'mode': 'download', 'source': 'auto', 'fallback': True}
    manager.save_preferences({'channel': 'beta', 'mode': 'notify'})
    assert manager.preferences() == {'channel': 'beta', 'mode': 'notify', 'source': 'auto', 'fallback': True}
    with pytest.raises(ValueError):
        manager.save_preferences({'channel': 'external', 'mode': 'notify'})
    payload = b'Offline installer fixture'
    digest = hashlib.sha256(payload).hexdigest()
    release = {'version': 'v0.2.0', 'notes': 'changes', 'page': '', 'assets': [{
        'name': 'StudyFlow_0.2.0_x64-setup.exe', 'digest': 'sha256:' + digest,
        'browser_download_url': 'https://github.com/07xh/StudyFlow/releases/download/v0.2.0/setup.exe'}]}
    monkeypatch.setattr(updater, 'release_info', lambda *a, **k: release)
    seen = []
    def download(url, checksum, destination, **kwargs):
        seen.append((url, checksum, destination))
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        return destination
    monkeypatch.setattr(updater, 'verified_download', download)
    assert manager.check('0.1.0')['release']['downloadable']
    result = manager.download('0.1.0', 'v0.2.0')
    assert result['sha256'] == digest
    assert seen[0][2].is_relative_to(tmp_path / 'StudyFlow' / 'updates')
    manager.download('0.1.0', 'v0.2.0')
    assert len(seen) == 1  # Startup B mode reuses the hash-verified download.
    seen[0][2].write_bytes(b'corrupted')
    manager.download('0.1.0', 'v0.2.0')
    assert len(seen) == 2
    with pytest.raises(ValueError):
        manager.download('0.1.0', '../../bad')
    release['assets'][0].pop('digest')
    assert not manager.check('0.1.0')['release']['downloadable']
    with pytest.raises(ValueError):
        manager.download('0.1.0', 'v0.2.0')


def test_update_ipc_has_explicit_error_codes(monkeypatch):
    from studyflow.services import bridge, update_manager
    monkeypatch.setattr(update_manager, 'check', lambda version: {'release': None})
    response = bridge.dispatch({'id':'u', 'version':1, 'operation':'updates.check', 'current_version':'0.1.0'})
    assert response == {'id':'u', 'ok':True, 'data':{'release':None}}
    bad = bridge.dispatch({'id':'u', 'version':1, 'operation':'updates.settings.save', 'settings':{}})
    assert bad['error'] == 'INVALID_UPDATE_SETTINGS'


def test_update_bridge_preserves_safe_failure_category(monkeypatch):
    from studyflow.services import bridge, update_manager
    def blocked(_version):
        raise updater.UpdateError("UPDATE_NETWORK_FAILED", "Private network detail")
    monkeypatch.setattr(update_manager, "check", blocked)
    result = bridge.dispatch({"id": "u", "version": 1, "operation": "updates.check",
                              "current_version": "0.1.0"})
    assert result == {"id": "u", "ok": False, "error": "UPDATE_NETWORK_FAILED"}
    assert "Private" not in str(result)


def test_missing_installer_is_not_misreported_as_invalid_preferences(monkeypatch, tmp_path):
    from studyflow.services import bridge, update_manager
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(updater, "release_info", lambda *a, **k: {
        "version": "v0.2.0", "notes": "release", "assets": []})
    result = bridge.dispatch({"id": "u", "version": 1, "operation": "updates.download",
                              "current_version": "0.1.0", "release_version": "v0.2.0"})
    assert result["error"] == "UPDATE_ASSET_UNAVAILABLE"


def test_changelog_only_returns_published_installed_and_skipped_versions(monkeypatch):
    import io
    import json
    releases = [
        {"tag_name": "v0.1.1-rc.12", "name": "Future", "body": "future"},
        {"tag_name": "v0.1.1-rc.11", "name": "Current", "body": "Current changes", "published_at": "2026-11-15T00:00:00Z"},
        {"tag_name": "v0.1.1-rc.10", "name": "Previous", "body": "Previous changes"},
        {"tag_name": "v0.1.1-rc.9", "name": "Old", "body": "Old changes"},
        {"tag_name": "v0.1.1-rc.8", "draft": True, "body": "Hidden"},
    ]
    class Response(io.BytesIO):
        def __enter__(self):
            return self
        def __exit__(self, *args):
            self.close()
    monkeypatch.setattr(updater, "urlopen", lambda *a, **k: Response(json.dumps(releases).encode()))
    current = updater.release_notes("0.1.1-rc.11")
    assert [row["version"] for row in current] == ["v0.1.1-rc.11"]
    skipped = updater.release_notes("0.1.1-rc.11", previous_version="0.1.1-rc.9")
    assert [row["version"] for row in skipped] == ["v0.1.1-rc.11", "v0.1.1-rc.10"]
    history = updater.release_notes("0.1.1-rc.11", history=True)
    assert [row["version"] for row in history] == ["v0.1.1-rc.11", "v0.1.1-rc.10", "v0.1.1-rc.9"]


def test_changelog_ipc_checks_input_and_preserves_safe_errors(monkeypatch):
    from studyflow.services import bridge, update_manager
    monkeypatch.setattr(update_manager, "changelog", lambda *a: {"entries": [{"version": "v0.2.0"}]})
    req = {"id": "notes", "version": 1, "operation": "updates.changelog",
           "current_version": "0.2.0", "history": False}
    assert bridge.dispatch(req)["data"]["entries"][0]["version"] == "v0.2.0"
    # Validation is applied before the network request in the actual updater.
    monkeypatch.setattr(update_manager, "changelog", lambda *a: updater.release_notes("bad"))
    assert bridge.dispatch(req)["error"] == "INVALID_UPDATE_SETTINGS"
    def blocked(*args):
        raise updater.UpdateError("UPDATE_NETWORK_FAILED", "Private URL")
    monkeypatch.setattr(update_manager, "changelog", blocked)
    result = bridge.dispatch(req)
    assert result["error"] == "UPDATE_NETWORK_FAILED"
    assert "Private" not in str(result)

def test_beta_update_chooses_highest_published_version_out_of_api_order(monkeypatch):
    import io
    import json
    releases = [
        {"tag_name": "v0.1.1-rc.9", "body": "outdated"},
        {"tag_name": "v0.1.1-rc.18", "body": "update 18"},
        {"tag_name": "v0.1.1-rc.17", "body": "update 17"},
        {"tag_name": "v0.1.1-rc.19", "body": "update 19"},
        {"tag_name": "v0.1.1-rc.20", "draft": True, "body": "not published"},
    ]
    monkeypatch.setattr(updater, "urlopen",
                        lambda *a, **k: io.BytesIO(json.dumps(releases).encode()))
    selected = updater.release_info("0.1.1-rc.17", channel="beta")
    assert selected is not None
    assert selected["version"] == "v0.1.1-rc.19"
    assert selected["notes"] == "update 19"


def test_history_sorts_versions_even_when_github_returns_unsorted_releases(monkeypatch):
    import io
    import json
    releases = [
        {"tag_name": "v0.1.1-rc.9", "body": "nine"},
        {"tag_name": "v0.1.1-rc.18", "body": "eighteen"},
        {"tag_name": "v0.1.1-rc.17", "body": "seventeen"},
        {"tag_name": "v0.1.1-rc.10", "body": "ten"},
    ]
    monkeypatch.setattr(updater, "urlopen",
                        lambda *a, **k: io.BytesIO(json.dumps(releases).encode()))
    history = updater.release_notes("0.1.1-rc.18", history=True)
    assert [entry["version"] for entry in history] == [
        "v0.1.1-rc.18", "v0.1.1-rc.17", "v0.1.1-rc.10", "v0.1.1-rc.9"
    ]


def test_latest_release_navigation_uses_highest_semver_with_verified_installer(monkeypatch):
    import io
    import json
    from studyflow.services import update_manager as manager, bridge
    digest = "a" * 64
    releases = [
        {"tag_name": "v0.1.1-rc.9", "assets": []},
        {"tag_name": "v0.1.1-rc.26", "draft": True, "assets": []},
        {"tag_name": "v0.1.1-rc.24", "assets": []},
        {"tag_name": "v0.1.1-rc.25", "assets": [{
            "name": "StudyFlow_0.1.1-rc.25_x64-setup.exe",
            "browser_download_url": "https://github.com/07xh/StudyFlow/releases/download/v0.1.1-rc.25/setup.exe",
            "digest": "sha256:" + digest,
        }]},
        {"tag_name": "v0.1.1-rc.23", "assets": []},
    ]
    urls = []
    def response(req, timeout):
        urls.append(req.full_url)
        return io.BytesIO(json.dumps(releases).encode())
    monkeypatch.setattr(updater, "urlopen", response)
    assert manager.latest() == {"version": "v0.1.1-rc.25"}
    assert "?per_page=100" in urls[0]
    assert bridge.dispatch({"id": "latest", "version": 1, "operation": "updates.latest"}) == {
        "id": "latest", "ok": True, "data": {"version": "v0.1.1-rc.25"}
    }


def test_latest_release_refuses_draft_uninstallable_or_unavailable_versions(monkeypatch):
    from studyflow.services import update_manager as manager
    monkeypatch.setattr(updater, "release_info", lambda *a, **kw: None)
    assert manager.latest() == {"version": None}
    monkeypatch.setattr(updater, "release_info", lambda *a, **kw: {
        "version": "v0.1.1-rc.27", "assets": []})
    assert manager.latest() == {"version": None}
    monkeypatch.setattr(updater, "release_info", lambda *a, **kw: {
        "version": "https://attacker.invalid", "assets": []})
    assert manager.latest() == {"version": None}
