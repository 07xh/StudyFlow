"""Validate the current user's own Zhidao cookie locally before saving.

The official SDK authenticates an in-memory candidate session. An unsuccessful
check never writes or replaces the existing cookie file. No PowerShell,
temporary credential input, or course API is needed for login.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

from .login_environment import initialize_login
from .qr_login_core import save_cookies_atomic

MAX_COOKIE_BYTES = 262_144
_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
_DOMAIN = re.compile(r"^(?:[a-z0-9-]+\.)*zhihuishu\.com$", re.I)


def parse_cookie(content: Any, mode: Any) -> list[dict[str, str]]:
    def invalid():
        return ValueError("INVALID_COOKIE_IMPORT")

    if not isinstance(content, str) or mode not in ("file", "text"):
        raise invalid()
    if not 2 <= len(content.encode("utf-8")) <= MAX_COOKIE_BYTES:
        raise invalid()
    value = content.lstrip("\ufeff").strip()
    if mode == "file" or value.startswith("["):
        try:
            rows = json.loads(value)
        except (ValueError, RecursionError):
            raise invalid() from None
    else:
        if "\r" in value or "\n" in value:
            raise invalid()
        value = re.sub(r"^Cookie:\s*", "", value, flags=re.I)
        rows = []
        for part in value.split(";"):
            name, sep, item = part.strip().partition("=")
            if not sep:
                raise invalid()
            rows.append({"name": name.strip(), "value": item.strip(),
                         "domain": ".zhihuishu.com", "path": "/"})
    if not isinstance(rows, list) or not 1 <= len(rows) <= 250:
        raise invalid()
    normalized = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise invalid()
        name, item = row.get("name"), row.get("value")
        domain, path = row.get("domain", ""), row.get("path", "/")
        if not all(isinstance(x, str) for x in (name, item, domain, path)):
            raise invalid()
        # Scope domainless imports to the first-party host, not every HTTP host.
        domain = (domain or ".zhihuishu.com").lower()
        if (not 1 <= len(name) <= 256 or not _NAME.fullmatch(name)
                or len(item) > 8192 or any(c in item for c in "\r\n\x00")
                or len(domain) > 253 or not _DOMAIN.fullmatch(domain.lstrip("."))
                or domain.startswith("..") or not path.startswith("/")
                or len(path) > 2048 or any(c in path for c in "\r\n\x00")):
            raise invalid()
        key = (name, domain.lstrip("."), path)
        if key in seen:
            raise invalid()
        seen.add(key)
        normalized.append({"name": name, "value": item, "domain": domain, "path": path})
    return normalized


def import_cookie(content: Any, mode: Any) -> dict[str, Any]:
    rows = parse_cookie(content, mode)
    session = None
    def fail(code, message):
        return {"imported": False, "code": code, "message": message}
    try:
        from loguru import logger
        from zhs.api.session_auth import SessionStatus, verify_session
        from zhs.utils.cookie import list_to_cookies
        # No upstream log record may contain a raw credential or login URL.
        logger.remove()
        _, session, directory = initialize_login(Path.home())
    except (ImportError, OSError, ValueError):
        return fail("LOGIN_ENVIRONMENT", "知到登录环境初始化失败；请检查用户目录权限及本机配置。")
    except Exception:
        return fail("LOGIN_INIT", "知到会话初始化失败，请运行连接诊断。")
    try:
        destination = directory / "cookies.json"
        if destination.is_symlink():
            return fail("LOGIN_STORAGE", "本机登录文件路径异常，未修改原有登录。")
        previous = destination.read_bytes() if destination.exists() else None
        session.cookies = list_to_cookies(rows)
        try:
            status = verify_session(session)
        except Exception:
            return fail("AUTH_UNAVAILABLE", "服务器认证暂不可用；未修改原有登录。请检查网络。")
        if status != SessionStatus.OK:
            if status == SessionStatus.EXPIRED:
                return fail("AUTH_REJECTED", "服务器未接受本次登录凭据；原有登录未修改。")
            return fail("AUTH_UNAVAILABLE", "服务器认证暂不可用；原有登录未修改。")
        current = destination.read_bytes() if destination.exists() else None
        if current != previous:
            return fail("SESSION_CHANGED", "核验期间登录状态发生变化，请重新导入。")
        save_cookies_atomic(destination, session.cookies)
        return {"imported": True, "code": "SESSION_OK", "message": "Cookie 导入成功；服务器已确认登录。"}
    except OSError:
        return fail("LOGIN_STORAGE", "无法读取或保存本机登录文件；请检查用户目录权限。")
    except (ValueError, TypeError, KeyError):
        return fail("INVALID_COOKIE_IMPORT", "Cookie 格式不正确；未修改原有登录。")
    finally:
        if session is not None:
            try:
                session.close()
            except Exception:
                pass
