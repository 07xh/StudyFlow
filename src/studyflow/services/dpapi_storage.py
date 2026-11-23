"""Provider-neutral Windows DPAPI, current-user storage helper.

Preserves CryptProtectData/CryptUnprotectData and UI-forbidden flags used by
older Yanxi and StudyFlow token blobs. No network, registry or token parsing.
"""
from __future__ import annotations

import ctypes
import os
from ctypes import wintypes


class DpapiStorageError(ValueError):
    """Stable local storage error without Windows diagnostic or token content."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class _Blob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def crypt(data: bytes, *, protect: bool) -> bytes:
    """Encrypt/decrypt an existing current-user DPAPI blob without a format change."""
    if os.name != "nt":
        raise DpapiStorageError("WINDOWS_ONLY")
    try:
        buffer = ctypes.create_string_buffer(data, len(data))
        source = _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
        result = _Blob()
        crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        func = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
        # 64-bit pointers and the existing CRYPTPROTECT_UI_FORBIDDEN=0x1 flag.
        func.argtypes = [
            ctypes.POINTER(_Blob), ctypes.c_void_p, ctypes.c_void_p,
            ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
            ctypes.POINTER(_Blob),
        ]
        func.restype = wintypes.BOOL
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        if not func(ctypes.byref(source), None, None, None, None, 0x1, ctypes.byref(result)):
            raise DpapiStorageError("DPAPI_STORAGE_FAILED")
        try:
            return ctypes.string_at(result.pbData, result.cbData)
        finally:
            kernel32.LocalFree(ctypes.cast(result.pbData, ctypes.c_void_p))
    except (OSError, AttributeError) as exc:
        raise DpapiStorageError("DPAPI_STORAGE_FAILED") from exc
