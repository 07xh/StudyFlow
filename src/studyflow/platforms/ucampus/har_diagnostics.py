"""Offline U校园 request-contract discovery without exporting sensitive HAR data.

Call inspect_har() locally with an owner-authorized HAR. Only structural
metadata is returned: method, fixed-host label, sanitized route family,
response status and JSON key names. Request/response bodies, query strings,
tokens, cookies, IDs, account names, and header values are never returned.
"""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlsplit

_UC_HOSTS = frozenset(("ucontent.unipus.cn", "uai.unipus.cn",
                       "ipub.unipus.cn", "ucloud.unipus.cn"))
_PREFIX = ("course", "api", "v2")
_SENSITIVE = frozenset(("cookie","authorization","token","access_token",
                         "jwt","password","secret","username","openid","userid",
                         "studentid","student_id","mobile","email","data",
                         "signature","sig","open_id","user_id"))
_ALLOWED_KEYS = frozenset((
    "rt","code","success","message","msg","status","error","progress",
    "value","duration","duration_time","time","position","currenttime",
    "current_time","course","courseid","course_id","unit","unitid","unit_id",
    "group","groupid","group_id","resource","resourceid","resource_id",
    "type","tab_type","method","event","action","page","pass","submit_type",
    "submittype","version","publishversion","publish_version",
    "content","result","units","leafs","state","strategies"
))
_MAX_ENTRIES=5000


def _json_keys(text: Any) -> list[str]:
    if not isinstance(text, str) or len(text) > 200_000:
        return []
    try:
        data=json.loads(text)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, dict):
        return []
    # Public field *names* only; never echo a confidential custom key.
    return sorted({key for key in data if isinstance(key,str)
                   and key.lower() in _ALLOWED_KEYS})[:30]


def _route_family(path: str) -> str:
    parts=[p for p in path.split("/") if p]
    lowered=[p.lower() for p in parts]
    if len(lowered)>=4 and tuple(lowered[:3])==_PREFIX:
        # Names after the fixed API prefix may contain a personal course ID.
        # Retain only independently known fixed API group names.
        family=lowered[3]
        if family in ("course_progress","content","submit","resource",
                      "course","learning","activity","heartbeat","progress"):
            return "/course/api/v2/"+family
        return "/course/api/v2/{other}"
    for category in ("heartbeat","progress","activity","course",
                     "content","play","video","audio","submit"):
        if category in lowered:
            return "/{"+category+"}"
    return "/{unknown}"


def inspect_har(document: dict[str, Any]) -> dict[str, Any]:
    """Return a bounded, privacy-redacted request summary, never payloads."""
    if not isinstance(document, dict):
        raise ValueError("UCAMPUS_INVALID_HAR")
    log=document.get("log")
    entries=log.get("entries") if isinstance(log,dict) else None
    if not isinstance(entries,list) or len(entries)>_MAX_ENTRIES:
        raise ValueError("UCAMPUS_INVALID_HAR")
    candidates=[]
    for index,entry in enumerate(entries):
        if not isinstance(entry,dict):
            continue
        req=entry.get("request")
        rsp=entry.get("response")
        if not isinstance(req,dict) or not isinstance(rsp,dict):
            continue
        url=req.get("url")
        if not isinstance(url,str) or len(url)>4096:
            continue
        try:
            parsed=urlsplit(url)
        except ValueError:
            continue
        if parsed.scheme!="https" or parsed.hostname not in _UC_HOSTS:
            continue
        method=req.get("method","")
        if method not in ("GET","POST","PUT","PATCH"):
            continue
        if len(candidates)>=300:
            break
        post=req.get("postData")
        content=rsp.get("content")
        status=rsp.get("status")
        candidates.append({
            "index": index,
            "host": parsed.hostname,
            "method": method,
            "route_family": _route_family(parsed.path),
            "http_status": status if type(status) is int and 100<=status<=599 else None,
            "request_json_keys": _json_keys(post.get("text") if isinstance(post,dict) else None),
            "response_json_keys": _json_keys(content.get("text") if isinstance(content,dict) else None),
        })
    return {"source": "local-redacted-har", "entries_seen": len(entries),
            "matching_requests": len(candidates), "requests": candidates}


def main(argv: list[str] | None = None) -> int:
    """Run the scrubber locally: never print the user's raw HAR or credentials."""
    import sys
    from pathlib import Path

    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("Usage: python -m studyflow.platforms.ucampus.har_diagnostics FILE.har", file=sys.stderr)
        return 2
    try:
        path = Path(args[0])
        if path.stat().st_size > 25_000_000:
            raise ValueError("UCAMPUS_INVALID_HAR")
        with path.open("r", encoding="utf-8") as source:
            document = json.load(source)
        summary = inspect_har(document)
        print(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
        return 0
    except (ValueError, OSError, UnicodeError):
        print("UCAMPUS_INVALID_HAR", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
