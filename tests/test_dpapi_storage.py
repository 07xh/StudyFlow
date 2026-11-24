"""Windows-native DPAPI compatibility tests using disposable synthetic tokens."""
from __future__ import annotations

import os

import pytest

from studyflow.services import dpapi_storage
from studyflow.services import question_bank as bank
from studyflow.services import yanxi_question_bank as yanxi


@pytest.mark.skipif(os.name != "nt", reason="Current-user DPAPI requires Windows")
def test_windows_dpapi_roundtrip_preserves_ciphertext_contract():
    secret = b"temporary-studyflow-test-token-" + b"x" * 32
    encrypted = dpapi_storage.crypt(secret, protect=True)
    assert encrypted != secret
    assert secret not in encrypted
    assert dpapi_storage.crypt(encrypted, protect=False) == secret
    with pytest.raises(dpapi_storage.DpapiStorageError, match="DPAPI_STORAGE_FAILED"):
        dpapi_storage.crypt(b"not-a-valid-dpapi-blob", protect=False)


@pytest.mark.skipif(os.name != "nt", reason="Current-user DPAPI requires Windows")
def test_legacy_token_migration_reads_real_windows_dpapi(tmp_path, monkeypatch):
    old = tmp_path / "old" / "yanxi.dpapi"
    current = tmp_path / "new" / "providers.dpapi"
    old.parent.mkdir(parents=True)
    monkeypatch.setattr(yanxi, "STORE_PATH", old)
    monkeypatch.setattr(bank, "STORE_PATH", current)
    token = "w" * 32
    old.write_bytes(dpapi_storage.crypt(token.encode("ascii"), protect=True))
    state = bank.list_tokens()
    assert state["tokens"][0]["active"] is True
    assert current.is_file() and not old.exists()
    assert token.encode("ascii") not in current.read_bytes()
    assert bank.list_tokens()["tokens"][0]["label"] == "原有言溪 Token"


@pytest.mark.skipif(os.name == "nt", reason="Non-Windows unsupported contract")
def test_non_windows_dpapi_rejects_without_creating_storage():
    with pytest.raises(dpapi_storage.DpapiStorageError, match="WINDOWS_ONLY"):
        dpapi_storage.crypt(b"test-data", protect=True)
