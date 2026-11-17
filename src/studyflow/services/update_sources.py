"""Optional SourceForge file mirror; GitHub Releases provides the trusted metadata."""
from __future__ import annotations
import re
from urllib.parse import quote, urlsplit

try:
    from ._sourceforge_config import SOURCEFORGE_PROJECT as _PROJECT
except ImportError:
    _PROJECT = ""

PROJECT_PATTERN = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?")


def sourceforge_project() -> str:
    if isinstance(_PROJECT, str) and PROJECT_PATTERN.fullmatch(_PROJECT):
        return _PROJECT
    return ""


def sourceforge_download_url(github_url: str) -> str | None:
    """Translate a GitHub Release file into a manually synced SourceForge FRS path."""
    project = sourceforge_project()
    if not project:
        return None
    parsed = urlsplit(github_url)
    prefix = "/07xh/StudyFlow/releases/download/"
    if (parsed.scheme != "https" or parsed.netloc != "github.com" or
            not parsed.path.startswith(prefix) or parsed.query or parsed.fragment):
        return None
    parts = parsed.path[len(prefix):].split("/")
    if (len(parts) != 2 or
            not re.fullmatch(r"v?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?", parts[0]) or
            not re.fullmatch(r"[A-Za-z0-9._-]+", parts[1]) or parts[1] in (".", "..")):
        return None
    tag, filename = parts
    return ("https://sourceforge.net/projects/" + project + "/files/releases/" +
            quote(tag, safe="._-") + "/" + quote(filename, safe="._-") + "/download")


def source_order(choice: str, fallback: bool, mirror_url: str | None) -> list[str]:
    if choice not in ("auto", "github", "sourceforge") or type(fallback) is not bool:
        raise ValueError("INVALID_UPDATE_SETTINGS")
    available = ["github"] + (["sourceforge"] if mirror_url else [])
    if choice == "auto":
        return (["sourceforge", "github"] if fallback else ["sourceforge"]) if mirror_url else ["github"]
    if choice not in available:
        return ["github"] if fallback else []
    return [choice] + ([name for name in available if name != choice] if fallback else [])
