"""Current-user DPAPI sessions with atomic storage and one-way legacy migration.

A local logout marker prevents old Credential Manager entries or inherited
environment variables from resurrecting sessions. No secret is logged.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile

from .dpapi_storage import crypt

PLATFORMS = {"yuketang", "xuexitong", "ucampus"}
MAX_BYTES = 128 * 1024


class SessionStorageError(RuntimeError):
    def __init__(self):
        super().__init__("SESSION_STORAGE_FAILED")


def _root() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    return base / "StudyFlow" / "sessions"


class SessionStore:
    def __init__(self, platform: str, service: str, account: str, root: Path | None = None):
        if platform not in PLATFORMS:
            raise ValueError("INVALID_PLATFORM")
        self.platform = platform
        self.service = service
        self.account = account
        self.path = (root if root is not None else _root()) / (platform + ".dpapi")

    def _read(self) -> tuple[bool, str | None]:
        try:
            if self.path.is_symlink():
                raise SessionStorageError()
            if self.path.stat().st_size > MAX_BYTES:
                raise SessionStorageError()
            blob = self.path.read_bytes()
        except FileNotFoundError:
            return False, None
        except OSError:
            raise SessionStorageError() from None
        try:
            data = json.loads(crypt(blob, protect=False))
            if not isinstance(data, dict) or data.get("v") != 1 or data.get("platform") != self.platform:
                raise SessionStorageError()
            value = data["value"]
            if value is not None and (not isinstance(value, str) or not value):
                raise SessionStorageError()
            return True, value
        except Exception:
            raise SessionStorageError() from None

    def _write(self, value: str | None, *, replace: bool) -> bool:
        temporary = None
        try:
            raw = json.dumps({"v": 1, "platform": self.platform, "value": value},
                             ensure_ascii=False).encode("utf-8")
            if len(raw) > MAX_BYTES // 2:
                raise SessionStorageError()
            blob = crypt(raw, protect=True)
            if len(blob) > MAX_BYTES:
                raise SessionStorageError()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if self.path.parent.is_symlink() or self.path.is_symlink():
                raise SessionStorageError()
            fd, name = tempfile.mkstemp(prefix=".session-", suffix=".tmp", dir=self.path.parent)
            temporary = Path(name)
            with os.fdopen(fd, "wb") as out:
                out.write(blob)
                out.flush()
                os.fsync(out.fileno())
            if replace:
                os.replace(temporary, self.path)
            else:
                # Exclusive publication: a simultaneous login/logout always wins
                # over legacy migration. On Windows rename never overwrites.
                try:
                    if os.name == "nt":
                        os.rename(temporary, self.path)
                    else:
                        os.link(temporary, self.path)
                except FileExistsError:
                    return False
            return True
        except Exception:
            raise SessionStorageError() from None
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass

    def _legacy(self) -> str | None:
        try:
            import keyring
            return keyring.get_password(self.service, self.account)
        except Exception:
            raise SessionStorageError() from None

    def load(self, *, fallback: str | None = None, validate=None) -> str | None:
        exists, value = self._read()
        if exists:
            return value
        legacy = self._legacy() or fallback
        if not legacy:
            return None
        if validate is not None:
            try:
                validate(legacy)
            except (ValueError, TypeError, KeyError):
                return None
        # Preserve legacy source until encrypted storage is known readable.
        self._write(legacy, replace=False)
        exists, value = self._read()
        if not exists:
            raise SessionStorageError()
        return value

    def save(self, value: str) -> None:
        if not isinstance(value, str) or not value:
            raise ValueError("INVALID_SESSION")
        self._write(value, replace=True)

    def clear(self) -> None:
        # Persist the logout marker FIRST so old values cannot reappear even
        # when Credential Manager deletion fails or another process migrates.
        self._write(None, replace=True)
        try:
            import keyring
            keyring.delete_password(self.service, self.account)
        except Exception:
            pass
