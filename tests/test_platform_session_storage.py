"""Synthetic migration and actual Windows current-user encryption checks."""
import os
from types import SimpleNamespace
import sys

import pytest

from studyflow.services import session_storage as storage


@pytest.mark.parametrize("platform", sorted(storage.PLATFORMS))
def test_session_migration_save_logout_and_no_stale_fallback(tmp_path, monkeypatch, platform):
    # Exercise atomic file operations without depending on the host keyring.
    monkeypatch.setattr(storage, "crypt", lambda data, protect: data)
    old = "synthetic-legacy"
    fake = SimpleNamespace(get_password=lambda *_: old,
                           delete_password=lambda *_: (_ for _ in ()).throw(OSError()))
    monkeypatch.setitem(sys.modules, "keyring", fake)
    store = storage.SessionStore(platform, "test-service", "test-account", tmp_path)
    assert store.load() == old
    assert store.path.exists()
    store.save("new-value-" + "x" * 10000)
    assert store.load().startswith("new-value-")
    store.clear()
    assert store.load(fallback="stale-environment") is None


def test_corrupt_store_never_falls_back(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "crypt", lambda data, protect: data)
    store = storage.SessionStore("yuketang", "test", "test", tmp_path)
    store.path.write_bytes(b"invalid")
    with pytest.raises(storage.SessionStorageError, match="SESSION_STORAGE_FAILED"):
        store.load(fallback="old")


def test_failed_migration_does_not_delete_legacy(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "crypt", lambda *args, **kwargs: (_ for _ in ()).throw(OSError()))
    fake = SimpleNamespace(get_password=lambda *_: "synthetic-legacy",
                           delete_password=lambda *_: pytest.fail("legacy removed before verification"))
    monkeypatch.setitem(sys.modules, "keyring", fake)
    store = storage.SessionStore("ucampus", "test", "test", tmp_path)
    with pytest.raises(storage.SessionStorageError):
        store.load()
    assert not store.path.exists()


@pytest.mark.skipif(os.name != "nt", reason="Current-user DPAPI requires Windows")
def test_real_windows_large_session_and_logout(tmp_path):
    store = storage.SessionStore("xuexitong", "StudyFlow.Test.Disposable", "test", tmp_path)
    secret = "synthetic-long-cookie-" + "s" * 10000
    store.save(secret)
    assert secret.encode() not in store.path.read_bytes()
    assert store.load() == secret
    store.clear()
    assert store.load() is None


def test_blank_profile_without_legacy_credentials(tmp_path, monkeypatch):
    fake = SimpleNamespace(get_password=lambda *_: None)
    monkeypatch.setitem(sys.modules, "keyring", fake)
    store = storage.SessionStore("yuketang", "test", "test", tmp_path)
    assert store.load() is None
    assert not store.path.exists()


def test_unavailable_legacy_backend_is_not_reported_as_missing(tmp_path, monkeypatch):
    def unavailable(*_args):
        raise RuntimeError("synthetic private backend detail")
    monkeypatch.setitem(sys.modules, "keyring", SimpleNamespace(get_password=unavailable))
    store = storage.SessionStore("ucampus", "test", "test", tmp_path)
    with pytest.raises(storage.SessionStorageError, match="^SESSION_STORAGE_FAILED$"):
        store.load()
    assert not store.path.exists()
