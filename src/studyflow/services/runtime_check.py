"""Offline import checks run by the frozen executable before packaging.

Explicit imports also make PyInstaller collect dependencies of runpy-loaded
original scripts, which its static analysis cannot otherwise discover.
"""
from __future__ import annotations

import concurrent.futures.thread  # noqa: F401
import copy  # noqa: F401
import json  # noqa: F401
import os
from pathlib import Path
import random  # noqa: F401
import runpy
import struct  # noqa: F401
import sys
import tempfile
import threading  # noqa: F401
from datetime import datetime  # noqa: F401

import requests  # noqa: F401
from dotenv import load_dotenv  # noqa: F401


def check_yuketang() -> int:
    from studyflow.services.legacy_playback import _legacy_source
    from studyflow.platforms.yuketang.legacy_config import _launcher
    stdout, stderr, cwd = sys.stdout, sys.stderr, Path.cwd()
    environment = dict(os.environ)
    try:
        with tempfile.TemporaryDirectory(prefix="studyflow-runtime-") as directory:
            os.environ["YKT_HOME"] = directory
            os.chdir(directory)
            try:
                # __main__ is intentionally not used: no task or request runs.
                module = runpy.run_path(str(_legacy_source()), run_name="studyflow_import_check")
                if not callable(module.get("main")) or not isinstance(_launcher().read_cfg(), dict):
                    return 5
            finally:
                for stream, original in ((sys.stdout, stdout), (sys.stderr, stderr)):
                    if stream is not original and hasattr(stream, "_file"):
                        stream.flush()
                        stream._file.close()
                sys.stdout, sys.stderr = stdout, stderr
                os.chdir(cwd)
        return 0
    except Exception:
        return 5
    finally:
        sys.stdout, sys.stderr = stdout, stderr
        os.chdir(cwd)
        os.environ.clear()
        os.environ.update(environment)
