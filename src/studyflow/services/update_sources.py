"""Trusted, build-configured release download sources.

The GitHub Release API remains the authoritative source for versions and SHA-256
digests. Mirrors only transport identical release bytes.
"""
from __future__ import annotations

import re
from urllib.parse import quote, urlsplit

try:
    from ._mirror_config import MIRROR_BASE_URL as _MIRROR_BASE_URL
except ImportError:
    _MIRROR_BASE_URL = ""


def mirror_base() -> str:
    """Return a HTTPS mirror base embedded in the Windows sidecar build."""
    raw = _MIRROR_BASE_URL
    if not isinstance(raw, str) or not raw or len(raw) > 512:
        return ""
    parsed = urlsplit(raw)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment or parsed.port
            or parsed.path not in ("", "/")):
        return ""
    return "https://" + parsed.hostname.lower()


def mirror_asset_url(github_url: str) -> str | None:
    """Map a fixed official asset URL to the mirror's immutable version path."""
    base = mirror_base()
    if not base:
        return None
    parsed = urlsplit(github_url)
    prefix = "/07xh/StudyFlow/releases/download/"
    if (parsed.scheme != "https" or parsed.netloc != "github.com"
            or not parsed.path.startswith(prefix) or parsed.query or parsed.fragment):
        return None
    suffix = parsed.path[len(prefix):]
    parts = suffix.split("/")
    if (len(parts) != 2 or not re.fullmatch(r"v?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?", parts[0])
            or not re.fullmatch(r"[A-Za-z0-9._-]+", parts[1]) or parts[1] in (".", "..")):
        return None
    return base + "/releases/" + "/".join(quote(part, safe="._-") for part in parts)


def source_order(choice: str, fallback: bool, mirror_url: str | None) -> list[str]:
    """Explicit selection keeps its priority; failover only uses known sources."""
    if choice not in ("auto", "github", "r2") or not isinstance(fallback, bool):
        raise ValueError("INVALID_UPDATE_SETTINGS")
    available = ["github"] + (["r2"] if mirror_url else [])
    if choice == "r2" and not mirror_url and not fallback:
        return []
    if choice == "auto":
        return (["r2", "github"] if mirror_url else ["github"])
    if choice not in available:
        return ["github"] if fallback else []
    return [choice] + ([name for name in available if name != choice] if fallback else [])
