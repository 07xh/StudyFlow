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

from . import updater, update_sources

# RC-only release line: new installations follow beta; persisted user preferences win.
DEFAULTS = {"channel": "beta", "mode": "download", "source": "auto", "fallback": True}


def home() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "StudyFlow" / "updates"


def _validated(value: object) -> dict:
    """Accept prior two-field preferences and migrate without losing choices."""
    if not isinstance(value, dict) or not {"channel", "mode"}.issubset(value):
        raise ValueError("INVALID_UPDATE_SETTINGS")
    if set(value) - set(DEFAULTS):
        raise ValueError("INVALID_UPDATE_SETTINGS")
    result = {**DEFAULTS, **value}
    if result["source"] == "sourceforge":
        result["source"] = "auto"
    if (result["channel"] not in ("stable", "beta")
            or result["mode"] not in ("notify", "download")
            or result["source"] not in ("auto", "github", "proxy")
            or type(result["fallback"]) is not bool):
        raise ValueError("INVALID_UPDATE_SETTINGS")
    return result

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


def latest() -> dict:
    """Newest actually published, installable release across stable and RC channels.

    GitHub's releases/latest excludes pre-releases, and its list order is not
    version order. Never offer a draft or a release without a verifiable x64
    installer as the desktop "GitHub latest" destination.
    """
    release = updater.release_info("0.0.0", channel="beta")
    if release is None or _installer(release) is None:
        return {"version": None}
    version = release["version"]
    if not isinstance(version, str) or len(version) > 80 or not updater.VERSION_PATTERN.fullmatch(version):
        return {"version": None}
    return {"version": version}


def changelog(current: str, previous: str | None = None, history: bool = False) -> dict:
    return {"entries": updater.release_notes(current, previous_version=previous, history=history)}


def sources() -> dict:
    """Public proxies require no setup; version metadata still comes from GitHub."""
    return {"github": True, "proxy": True}


def download(current: str, version: str) -> dict:
    if not isinstance(version, str) or len(version) > 80 or not updater.VERSION_PATTERN.fullmatch(version):
        raise ValueError("INVALID_UPDATE_SETTINGS")
    release = _release(current)
    asset = _installer(release) if release and release["version"] == version else None
    if asset is None:
        raise updater.UpdateError("UPDATE_ASSET_UNAVAILABLE", "Update asset unavailable")
    url, checksum = asset
    target = home() / ("StudyFlow-" + version.lstrip("v") + "-x64-setup.exe")
    if target.is_symlink():
        raise ValueError("UPDATE_ASSET_UNAVAILABLE")
    try:
        if target.is_file():
            digest = hashlib.sha256()
            with target.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            if hmac.compare_digest(digest.hexdigest(), checksum):
                return {"filename": target.name, "sha256": checksum, "source": "cache"}
    except OSError:
        pass

    if not update_sources.trusted_release_url(url):
        raise updater.UpdateError("UPDATE_ASSET_UNAVAILABLE", "Invalid GitHub release asset")
    pref = preferences()
    order = update_sources.source_order(pref["source"], pref["fallback"])
    last_error = None
    for source in order:
        try:
            if source == "github":
                updater.verified_download(url, checksum, target)
            else:
                proxy = update_sources.proxy_url(url, source)
                updater.verified_download(proxy, checksum, target, mirror_host=source)
            return {"filename": target.name, "sha256": checksum, "source": source}
        except updater.UpdateError as exc:
            last_error = exc
            if exc.code == "UPDATE_STORAGE_FAILED":
                raise
    if last_error is not None:
        raise last_error
    raise updater.UpdateError("UPDATE_DOWNLOAD_FAILED", "No usable download source")
