"""Bounded update operations for UI; server assets decide URL and checksum."""
from __future__ import annotations

import json
import hashlib
import hmac
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse

from . import updater

# RC-only release line: new installations follow beta; persisted user preferences win.
DEFAULTS = {"channel": "beta", "mode": "download"}


def home() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "StudyFlow" / "updates"


def _validated(value: object) -> dict:
    if (not isinstance(value, dict) or set(value) != set(DEFAULTS)
            or value["channel"] not in ("stable", "beta") or value["mode"] not in ("notify", "download")):
        raise ValueError("INVALID_UPDATE_SETTINGS")
    return dict(value)


def preferences() -> dict:
    path = home() / "preferences.json"
    try:
        if path.is_symlink() or path.stat().st_size > 2048:
            return dict(DEFAULTS)
        return _validated(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save_preferences(value: object) -> dict:
    settings = _validated(value)
    root = home()
    root.mkdir(parents=True, exist_ok=True)
    path = root / "preferences.json"
    if path.is_symlink():
        raise ValueError("INVALID_UPDATE_SETTINGS")
    fd, temporary = tempfile.mkstemp(prefix=".preferences-", dir=root)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(settings, stream)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return settings


def _installer(release: dict) -> tuple[str, str] | None:
    candidates = []
    for asset in release.get("assets", []):
        name = asset.get("name", "")
        url = asset.get("browser_download_url", "")
        digest = asset.get("digest", "")
        if not all(isinstance(x, str) for x in (name, url, digest)):
            continue
        parsed = urlparse(url)
        if (name.lower().endswith(".exe") and ("x64" in name.lower() or "x86_64" in name.lower())
                and parsed.scheme == "https" and parsed.netloc == "github.com"
                and parsed.path.startswith(f"/{updater.OWNER}/{updater.REPO}/releases/download/")
                and re.fullmatch(r"sha256:[a-fA-F0-9]{64}", digest)):
            candidates.append((url, digest[7:].lower()))
    return candidates[0] if len(candidates) == 1 else None


def _release(current: str) -> dict | None:
    if not isinstance(current, str) or len(current) > 80:
        raise ValueError("INVALID_UPDATE_SETTINGS")
    updater.version_parts(current)
    return updater.release_info(current, channel=preferences()["channel"])


def check(current: str) -> dict:
    release = _release(current)
    return {"release": {
        "version": release["version"], "notes": str(release.get("notes") or "")[:30000],
        "downloadable": _installer(release) is not None,
    } if release else None}


def changelog(current: str, previous: str | None = None, history: bool = False) -> dict:
    return {"entries": updater.release_notes(current, previous_version=previous, history=history)}


def download(current: str, version: str) -> dict:
    if not isinstance(version, str) or len(version) > 80 or not updater.VERSION_PATTERN.fullmatch(version):
        raise ValueError("INVALID_UPDATE_SETTINGS")
    release = _release(current)
    asset = _installer(release) if release and release["version"] == version else None
    if asset is None:
        raise updater.UpdateError("UPDATE_ASSET_UNAVAILABLE", "Update asset unavailable")
    url, checksum = asset
    # No caller-controlled path or executable name crosses the IPC boundary.
    target = home() / ("StudyFlow-" + version.lstrip("v") + "-x64-setup.exe")
    if target.is_symlink():
        raise ValueError("UPDATE_ASSET_UNAVAILABLE")
    reusable = False
    try:
        if target.is_file():
            digest = hashlib.sha256()
            with target.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            reusable = hmac.compare_digest(digest.hexdigest(), checksum)
    except OSError:
        pass
    if not reusable:
        updater.verified_download(url, checksum, target)
    return {"filename": target.name, "sha256": checksum}
