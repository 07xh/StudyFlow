"""Structural HAR diagnostics must never export the user's secrets or IDs."""
from studyflow.platforms.ucampus.har_diagnostics import inspect_har
import json
import pytest


def test_offline_har_redacts_account_and_request_payload_values():
    secret="SECRET_LONG_JWT_ACCOUNT_PRIVATE"
    entry={
        "request":{"url":"https://ucontent.unipus.cn/course/api/v2/course_progress/course-v2:123/"+secret+"/default?token="+secret,
                   "method":"POST",
                   "headers":[{"name":"Authorization","value":secret}],
                   "postData":{"text":json.dumps({"course_id":"secret-course","position":15,
                                                   "privateUsername":secret,"token":secret})}},
        "response":{"status":200,
                    "content":{"text":json.dumps({"code":0,"data":{"jwt":secret},
                                                    "privatePassword":secret})}}
    }
    result=inspect_har({"log":{"entries":[entry]}})
    text=json.dumps(result,ensure_ascii=False)
    assert secret not in text
    assert "secret-course" not in text
    assert "privateUsername" not in text
    assert "privatePassword" not in text
    assert result["requests"][0]["route_family"]=="/course/api/v2/course_progress"
    assert result["requests"][0]["request_json_keys"]==["course_id","position"]
    assert result["requests"][0]["response_json_keys"]==["code"]


def test_only_known_official_https_hosts_are_reported():
    entries=[]
    for url in ("https://example.org/api", "http://ucontent.unipus.cn/api",
                "https://ucontent.unipus.cn.evil.org/api",
                "https://uai.unipus.cn/api/cmgt/course/list"):
        entries.append({"request":{"method":"GET","url":url},"response":{"status":200}})
    result=inspect_har({"log":{"entries":entries}})
    assert len(result["requests"])==1
    assert result["requests"][0]["host"]=="uai.unipus.cn"


def test_fails_closed_on_unbounded_or_bad_har():
    with pytest.raises(ValueError):
        inspect_har({"log":{"entries":"invalid"}})
    with pytest.raises(ValueError):
        inspect_har({"log":{"entries":[{}]*5001}})
    with pytest.raises(ValueError):
        inspect_har([])


def test_cli_emits_redacted_summary_not_private_payload(tmp_path, capsys):
    from studyflow.platforms.ucampus.har_diagnostics import main
    secret="SUPERSENSITIVE_LOGIN_TOKEN"
    document={"log":{"entries":[{
        "request":{"method":"POST",
                   "url":"https://ucontent.unipus.cn/course/api/v2/activity?token="+secret,
                   "postData":{"text":json.dumps({"position":12,"token":secret})}},
        "response":{"status":200,"content":{"text":json.dumps({"code":1,"data":secret})}}
    }]}}
    har=tmp_path/"test.har"
    har.write_text(json.dumps(document),encoding="utf-8")
    assert main([str(har)]) == 0
    output=capsys.readouterr().out
    assert secret not in output
    assert "position" in output
    assert "UCAMPUS_INVALID_HAR" not in output
    assert main([])==2
