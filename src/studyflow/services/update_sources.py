"""Fixed public proxy fallbacks for official GitHub Release installer assets.

These untrusted services only transport bytes. Release metadata and SHA-256
always come directly from GitHub. Never proxy account credentials or API calls.
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

PROXIES = ("gh-proxy.org", "ghfast.top")
RELEASE_PREFIX = "/07xh/StudyFlow/releases/download/"
TAG_PATTERN = re.compile(r"v?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?")
ASSET_PATTERN = re.compile(r"[A-Za-z0-9._-]+")


def trusted_release_url(url: str) -> bool:
    if not isinstance(url, str):
        return False
    parts = urlsplit(url)
    if (parts.scheme != "https" or parts.netloc != "github.com"
            or parts.query or parts.fragment or not parts.path.startswith(RELEASE_PREFIX)):
        return False
    suffix = parts.path[len(RELEASE_PREFIX):].split("/")
    return (len(suffix) == 2 and bool(TAG_PATTERN.fullmatch(suffix[0]))
            and bool(ASSET_PATTERN.fullmatch(suffix[1]))
            and suffix[1] not in (".", ".."))


def proxy_url(url: str, domain: str) -> str:
    if domain not in PROXIES or not trusted_release_url(url):
        raise ValueError("Untrusted GitHub Release proxy target")
    return "https://" + domain + "/" + url


def source_order(choice: str, fallback: bool) -> list[str]:
    """Source labels are fixed; changing the order never changes the SHA-256."""
    if choice not in ("auto", "github", "proxy") or type(fallback) is not bool:
        raise ValueError("INVALID_UPDATE_SETTINGS")
    if choice == "github":
        return ["github", *PROXIES] if fallback else ["github"]
    if choice == "proxy":
        return [*PROXIES, "github"] if fallback else list(PROXIES)
    return [*PROXIES, "github"] if fallback else [PROXIES[0]]
