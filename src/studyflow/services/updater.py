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
def _http_rate_limited(error: HTTPError) -> bool:
    """Only call a 403 a rate limit when GitHub confirms it in headers."""
    headers = error.headers or {}
    return error.code == 429 or (
        error.code == 403
        and (headers.get("X-RateLimit-Remaining") == "0" or bool(headers.get("Retry-After")))
    )


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
    url = API + ("/latest" if channel == "stable" else "?per_page=100")
    req = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "StudyFlow-Updater"})
    try:
        with urlopen(req, timeout=timeout) as response:
            data = json.load(response)
    except HTTPError as exc:
        if exc.code == 404:
            return None
        code = "UPDATE_RATE_LIMITED" if _http_rate_limited(exc) else "UPDATE_NETWORK_FAILED"
        raise UpdateError(code, "GitHub release lookup failed") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise UpdateError("UPDATE_NETWORK_FAILED", "GitHub release lookup failed") from exc
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise UpdateError("UPDATE_RELEASE_INVALID", "Invalid release metadata") from exc
    releases = [data] if isinstance(data, dict) else data
    if not isinstance(releases, list) or any(not isinstance(row, dict) for row in releases):
        raise UpdateError("UPDATE_RELEASE_INVALID", "Invalid release metadata")
    best = None
    for release in releases:
        if release.get("draft") or (channel == "stable" and release.get("prerelease")):
            continue
        tag = release.get("tag_name", "")
        try:
            newer = is_newer(tag, current_version)
        except ValueError:
            continue
        if newer and (best is None or is_newer(tag, best["version"])):
            best = {"version": tag, "notes": release.get("body") or "",
                    "assets": release.get("assets") or [], "page": release.get("html_url")}
    # GitHub Release API order is not guaranteed to be semantic-version order:
    # do not offer RC 18 if RC 19 is also published later in the response.
    return best



def release_notes(current_version: str, previous_version: str | None = None,
                  history: bool = False, timeout: int = 10) -> list[dict]:
    """Read real published release notes, never an unverified future changelog.

    Startup returns the installed version (or published versions after the
    previously seen version); history shows up to 12 recent published versions.
    """
    if (not isinstance(current_version, str) or len(current_version) > 80
            or not VERSION_PATTERN.fullmatch(current_version)):
        raise ValueError("Invalid release version")
    if (previous_version is not None and
            (not isinstance(previous_version, str) or len(previous_version) > 80
             or not VERSION_PATTERN.fullmatch(previous_version))):
        raise ValueError("Invalid previous release version")
    if not isinstance(history, bool):
        raise ValueError("Invalid release history mode")
    req = Request(API + "?per_page=30",
                  headers={"Accept": "application/vnd.github+json", "User-Agent": "StudyFlow-Updater"})
    try:
        with urlopen(req, timeout=timeout) as response:
            data = json.load(response)
    except HTTPError as exc:
        if exc.code == 404:
            return []
        code = "UPDATE_RATE_LIMITED" if _http_rate_limited(exc) else "UPDATE_NETWORK_FAILED"
        raise UpdateError(code, "GitHub changelog lookup failed") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise UpdateError("UPDATE_NETWORK_FAILED", "GitHub changelog lookup failed") from exc
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise UpdateError("UPDATE_RELEASE_INVALID", "Invalid changelog metadata") from exc
    if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
        raise UpdateError("UPDATE_RELEASE_INVALID", "Invalid changelog metadata")
    entries = []
    for release in data:
        if release.get("draft"):
            continue
        tag = release.get("tag_name")
        if not isinstance(tag, str) or len(tag) > 80 or not VERSION_PATTERN.fullmatch(tag):
            continue
        if is_newer(tag, current_version):
            continue  # Do not claim changes from a version that is not installed.
        if previous_version is not None and not is_newer(tag, previous_version):
            continue
        if previous_version is None and not history and is_newer(current_version, tag):
            continue  # First migration: only the matching installed release.
        title = release.get("name")
        notes = release.get("body")
        published = release.get("published_at")
        entries.append({
            "version": tag,
            "title": title[:160] if isinstance(title, str) else "",
            "notes": notes[:16000] if isinstance(notes, str) else "",
            "published_at": published[:48] if isinstance(published, str) else "",
        })
    # A Release's creation timestamp can differ from publication order.
    # Present the actual installed/previous versions newest first.
    from functools import cmp_to_key
    def by_version(left, right):
        if is_newer(left["version"], right["version"]):
            return -1
        if is_newer(right["version"], left["version"]):
            return 1
        return 0
    entries.sort(key=cmp_to_key(by_version))
    return entries[:12 if history else 15]

def verified_download(url: str, sha256: str, destination: Path, timeout: int = 60,
                      *, mirror_host: str | None = None) -> Path:
    """Resume trusted HTTPS update bytes, verify GitHub digest, publish atomically.

    Network failures preserve a digest-scoped .part; invalid redirects, unexpected
    Range responses and checksum mismatches never publish unverified binaries.
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    official = (parsed.scheme == "https" and parsed.hostname == "github.com"
                and parsed.netloc == "github.com"
                and parsed.path.startswith(f"/{OWNER}/{REPO}/releases/download/")
                and not parsed.query and not parsed.fragment)
    sourceforge = (parsed.scheme == "https" and mirror_host == "sourceforge.net"
                   and parsed.netloc == "sourceforge.net" and not parsed.query
                   and not parsed.fragment and re.fullmatch(
                       r"/projects/[a-z0-9-]+/files/releases/v?\d+(?:\.\d+){1,3}"
                       r"(?:-[A-Za-z0-9.-]+)?/[A-Za-z0-9._-]+/download", parsed.path))
    if not (official or sourceforge):
        raise ValueError("Untrusted download URL")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", sha256):
        raise ValueError("Invalid SHA-256")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + "." + sha256.lower()[:16] + ".part")
    if destination.is_symlink() or partial.is_symlink():
        raise UpdateError("UPDATE_STORAGE_FAILED", "Update destination is not a regular file")
    permitted_hosts = ({"github.com", "objects.githubusercontent.com",
                        "release-assets.githubusercontent.com"} if official else
                       {"sourceforge.net", "downloads.sourceforge.net"})

    def request_once(restart: bool = False) -> Path:
        offset = partial.stat().st_size if partial.is_file() else 0
        if offset > 4 * 1024 * 1024 * 1024:
            partial.unlink(missing_ok=True)
            offset = 0
        headers = {"User-Agent": "StudyFlow-Updater"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        req = Request(url, headers=headers)
        try:
            with urlopen(req, timeout=timeout) as response:
                final = urlparse(response.geturl())
                trusted = (final.hostname in permitted_hosts or
                           (sourceforge and bool(final.hostname) and
                            final.hostname.endswith(".dl.sourceforge.net")))
                if final.scheme != "https" or not trusted:
                    partial.unlink(missing_ok=True)
                    raise UpdateError("UPDATE_REDIRECT_REJECTED", "Untrusted redirect")
                status = getattr(response, "status", 200)
                expected_end = None
                content_range = (response.getheader("Content-Range") if hasattr(response, "getheader") else None)
                if offset and status == 206:
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+|\*)", content_range or "")
                    if (not match or int(match.group(1)) != offset
                            or int(match.group(2)) < offset
                            or (match.group(3) != "*" and int(match.group(3)) <= int(match.group(2)))):
                        partial.unlink(missing_ok=True)
                        raise UpdateError("UPDATE_DOWNLOAD_FAILED", "Invalid partial response")
                    expected_end = int(match.group(2)) + 1
                    mode = "ab"
                elif status == 200:
                    # A server ignoring Range must NOT have bytes appended.
                    content_length = (response.getheader("Content-Length")
                                      if hasattr(response, "getheader") else None)
                    if content_length and content_length.isdecimal():
                        expected_end = int(content_length)
                    mode = "wb"
                elif status == 206 and not offset:
                    partial.unlink(missing_ok=True)
                    raise UpdateError("UPDATE_DOWNLOAD_FAILED", "Unexpected partial response")
                else:
                    raise UpdateError("UPDATE_DOWNLOAD_FAILED", "Unexpected download response")
                with partial.open(mode) as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
            if expected_end is not None and partial.stat().st_size < expected_end:
                # Preserve partial data when a server closes early without an exception.
                raise UpdateError("UPDATE_DOWNLOAD_FAILED", "Incomplete download response")
            digest = hashlib.sha256()
            with partial.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            if digest.hexdigest().lower() != sha256.lower():
                partial.unlink(missing_ok=True)
                raise UpdateError("UPDATE_CHECKSUM_FAILED", "Download checksum mismatch")
            os.replace(partial, destination)
            return destination
        except HTTPError as exc:
            if exc.code == 416 and offset and not restart:
                partial.unlink(missing_ok=True)
                return request_once(restart=True)
            code = "UPDATE_RATE_LIMITED" if _http_rate_limited(exc) else "UPDATE_DOWNLOAD_FAILED"
            raise UpdateError(code, "Release download failed") from exc
        except (URLError, TimeoutError) as exc:
            raise UpdateError("UPDATE_DOWNLOAD_FAILED", "Release download failed") from exc
        except OSError as exc:
            raise UpdateError("UPDATE_STORAGE_FAILED", "Cannot save update file") from exc

    return request_once()
