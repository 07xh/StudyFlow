from studyflow.platforms.yuketang import credentials
from studyflow.services.bridge import dispatch


def test_scope_metadata_never_returns_session_token_or_sign(monkeypatch):
    cfg = credentials.YuketangConfig('secret-session', 'secret-csrf', '11', '22', 'secret-sign')
    monkeypatch.setattr(credentials, 'load', lambda: cfg)
    result = dispatch({'id': 'scope1', 'version': 1, 'operation': 'yuketang.scope.get'})
    assert result['ok']
    assert result['data'] == {'classroom_id': '11', 'university_id': '22', 'has_session': True, 'has_sign': True}
    assert 'secret' not in str(result)


def test_scope_save_preserves_hidden_credentials_and_unchanged_sign(monkeypatch):
    cfg = credentials.YuketangConfig('secret-session', 'secret-csrf', '11', '22', 'secret-sign')
    monkeypatch.setattr(credentials, 'load', lambda: cfg)
    writes = []
    monkeypatch.setattr(credentials, 'save', lambda value: writes.append(value))
    request = {'id': 'scope2', 'version': 1, 'operation': 'yuketang.scope.save',
               'scope': {'classroom_id': '33', 'university_id': '44'}}
    assert dispatch(request)['ok']
    assert writes == [{**cfg.__dict__, 'classroom_id': '33', 'university_id': '44'}]
    request['scope']['sign'] = ''
    assert dispatch(request)['ok']
    assert writes[-1]['sign'] == ''
    assert writes[-1]['session_id'] == cfg.session_id


def test_scope_save_rejects_missing_session_invalid_ids_and_credential_replacement(monkeypatch):
    writes = []
    monkeypatch.setattr(credentials, 'save', lambda value: writes.append(value))
    monkeypatch.setattr(credentials, 'load', lambda: None)
    request = {'id': 'scope3', 'version': 1, 'operation': 'yuketang.scope.save',
               'scope': {'classroom_id': '33', 'university_id': '44'}}
    assert dispatch(request)['error'] == 'PLATFORM_NOT_READY'
    monkeypatch.setattr(credentials, 'load', lambda: credentials.YuketangConfig('s', 'c', '11', '22'))
    request['scope']['classroom_id'] = '../invalid'
    assert dispatch(request)['error'] == 'INVALID_REQUEST'
    request['scope'] = {'classroom_id': '33', 'university_id': '44', 'session_id': 'replacement'}
    assert dispatch(request)['error'] == 'INVALID_REQUEST'
    assert writes == []


def test_invalid_classroom_config_reports_input_error_not_windows_storage_failure(monkeypatch):
    request = {"id": "scope-invalid", "version": 1, "operation": "yuketang.configure",
               "configuration": {"session_id": "sample", "csrf_token": "sample",
                                 "classroom_id": "", "university_id": ""}}
    # Validate at the credentials layer before touching Windows Credential Manager.
    result = dispatch(request)
    assert not result["ok"]
    assert result["error"] == "INVALID_YUKETANG_CONFIGURATION"
    assert "sample" not in str(result)

    def storage_unavailable(_):
        raise OSError("private Windows storage diagnostic")
    monkeypatch.setattr(credentials, "save", storage_unavailable)
    result = dispatch(request)
    assert result["error"] == "CREDENTIAL_STORAGE_FAILED"
    assert "private Windows" not in str(result)
