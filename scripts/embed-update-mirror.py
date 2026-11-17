"""Embed a trusted, public HTTPS release mirror in the packaged Python sidecar.

Only the build pipeline sets this value. No application user can submit arbitrary
mirror URLs over IPC. Leaving the CI variable empty disables R2 cleanly.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

raw = os.environ.get("STUDYFLOW_R2_PUBLIC_BASE_URL", "").strip()
if raw:
    parsed = urlsplit(raw)
    if (len(raw) > 512 or parsed.scheme != "https" or not parsed.hostname
            or parsed.username or parsed.password or parsed.port or parsed.query
            or parsed.fragment or parsed.path not in ("", "/")):
        raise SystemExit("STUDYFLOW_R2_PUBLIC_BASE_URL must be a bare HTTPS origin")
    raw = "https://" + parsed.hostname.lower()
path = Path(__file__).resolve().parents[1] / "src/studyflow/services/_mirror_config.py"
path.write_text("# Generated at build time; do not edit or commit.\nMIRROR_BASE_URL = " + json.dumps(raw) + "\n", encoding="utf-8")
print("Update mirror configured:" if raw else "Update mirror disabled (no public URL configured).")
