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
    assert manager.preferences() == {'channel': 'beta', 'mode': 'download'}
    manager.save_preferences({'channel': 'beta', 'mode': 'notify'})
    assert manager.preferences() == {'channel': 'beta', 'mode': 'notify'}
    with pytest.raises(ValueError):
        manager.save_preferences({'channel': 'external', 'mode': 'notify'})
    payload = b'Offline installer fixture'
    digest = hashlib.sha256(payload).hexdigest()
    release = {'version': 'v0.2.0', 'notes': 'changes', 'page': '', 'assets': [{
        'name': 'StudyFlow_0.2.0_x64-setup.exe', 'digest': 'sha256:' + digest,
        'browser_download_url': 'https://github.com/07xh/StudyFlow/releases/download/v0.2.0/setup.exe'}]}
    monkeypatch.setattr(updater, 'release_info', lambda *a, **k: release)
    seen = []
    def download(url, checksum, destination):
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
