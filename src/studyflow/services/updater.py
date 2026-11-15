"""GitHub Releases update discovery and verified download (no automatic execution)."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

OWNER = "07xh"
REPO = "StudyFlow"
API = f"https://api.github.com/repos/{OWNER}/{REPO}/releases"

class UpdateError(ValueError):
    """Public error code with no server response, path, or URL disclosure."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
VERSION_PATTERN = re.compile(r"^v?(\d+(?:\.\d+){1,3})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")


def version_parts(value: str) -> tuple[int, ...]:
    match = VERSION_PATTERN.fullmatch(value.strip())
    if not match:
        raise ValueError("Invalid release version")
    return tuple(int(x) for x in match.group(1).split("."))


def is_newer(candidate: str, current: str) -> bool:
    a, b = version_parts(candidate), version_parts(current)
    length = max(len(a), len(b))
    numbers_a, numbers_b = a + (0,) * (length - len(a)), b + (0,) * (length - len(b))
    if numbers_a != numbers_b:
        return numbers_a > numbers_b
    pre_a, pre_b = VERSION_PATTERN.fullmatch(candidate.strip()).group(2), VERSION_PATTERN.fullmatch(current.strip()).group(2)
    if pre_a is None or pre_b is None:
        return pre_a is None and pre_b is not None
    def prerelease(value):
        return tuple((0, int(part)) if part.isdigit() else (1, part) for part in value.split('.'))
    return prerelease(pre_a) > prerelease(pre_b)


def release_info(current_version: str, channel: str = "stable", timeout: int = 10) -> dict | None:
    """Returns a newer release's metadata, or None. Never downloads or runs binaries."""
    if channel not in ("stable", "beta"):
        raise ValueError("Unsupported update channel")
    url = API + ("/latest" if channel == "stable" else "?per_page=20")
    req = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "StudyFlow-Updater"})
    try:
        with urlopen(req, timeout=timeout) as response:
            data = json.load(response)
    except HTTPError as exc:
        if exc.code == 404:
            return None
        code = "UPDATE_RATE_LIMITED" if exc.code in (403, 429) else "UPDATE_NETWORK_FAILED"
        raise UpdateError(code, "GitHub release lookup failed") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise UpdateError("UPDATE_NETWORK_FAILED", "GitHub release lookup failed") from exc
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise UpdateError("UPDATE_RELEASE_INVALID", "Invalid release metadata") from exc
    releases = [data] if isinstance(data, dict) else data
    if not isinstance(releases, list) or any(not isinstance(row, dict) for row in releases):
        raise UpdateError("UPDATE_RELEASE_INVALID", "Invalid release metadata")
    for release in releases:
        if release.get("draft") or (channel == "stable" and release.get("prerelease")):
            continue
        tag = release.get("tag_name", "")
        try:
            newer = is_newer(tag, current_version)
        except ValueError:
            continue
        if newer:
            return {"version": tag, "notes": release.get("body") or "",
                    "assets": release.get("assets") or [], "page": release.get("html_url")}
    return None


def verified_download(url: str, sha256: str, destination: Path, timeout: int = 60) -> Path:
    """Download to a temporary file, verify digest, then atomically publish the file.

    Only accept official GitHub release asset URLs. Never execute the downloaded file.
    """
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "github.com" or not parsed.path.startswith(f"/{OWNER}/{REPO}/releases/download/"):
        raise ValueError("Untrusted download URL")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", sha256):
        raise ValueError("Invalid SHA-256")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".studyflow-", dir=destination.parent)
    os.close(fd)
    temp = Path(temp_name)
    digest = hashlib.sha256()
    try:
        req = Request(url, headers={"User-Agent": "StudyFlow-Updater"})
        with urlopen(req, timeout=timeout) as response, temp.open("wb") as output:
            final = urlparse(response.geturl())
            if final.scheme != "https" or final.hostname not in ("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"):
                raise UpdateError("UPDATE_REDIRECT_REJECTED", "Untrusted redirect")
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest().lower() != sha256.lower():
            raise UpdateError("UPDATE_CHECKSUM_FAILED", "Download checksum mismatch")
        os.replace(temp, destination)
        return destination
    except HTTPError as exc:
        code = "UPDATE_RATE_LIMITED" if exc.code in (403, 429) else "UPDATE_DOWNLOAD_FAILED"
        raise UpdateError(code, "GitHub release download failed") from exc
    except (URLError, TimeoutError) as exc:
        raise UpdateError("UPDATE_DOWNLOAD_FAILED", "GitHub release download failed") from exc
    except OSError as exc:
        raise UpdateError("UPDATE_STORAGE_FAILED", "Cannot save update file") from exc
    finally:
        temp.unlink(missing_ok=True)
