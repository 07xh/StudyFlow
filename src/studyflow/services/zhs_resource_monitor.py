"""StudyFlow-only, read-only ZHS resource context for the local task panel.

The vendored ZHS 0.1.5 console observer stays unchanged. This subclass is
instantiated only by the StudyFlow worker and publishes resource identity from
already fetched ZHS Resource models. It never invokes progress/report endpoints.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time

ALLOWED_KINDS = frozenset(("video", "ppt", "article", "other"))
PRIVATE_MARKERS = ("http:", "https:", "cookie", "token", "authorization", "password", "secret", "apikey", "api_key")


def safe_resource_title(value: object) -> str | None:
    """Keep a short local display label, never credentials or arbitrary CLI text."""
    if not isinstance(value, str):
        return None
    label = " ".join(value.split()).strip()
    if not label or len(label) > 90 or any(ord(ch) < 32 for ch in label):
        return None
    if any(marker in label.lower() for marker in PRIVATE_MARKERS):
        return None
    if "@" in label or "=" in label or "\x1b" in label:
        return None
    return label


def create_resource_monitor(base_class: type, token: str, directory: Path):
    """Add a bounded, atomic UI snapshot on top of the original numeric observer."""

    class ResourceMonitor(base_class):
        def __init__(self):
            super().__init__(token, directory=directory)
            self.resource_kind: str | None = None
            self.resource_name: str | None = None

        def mark_resource(self, kind: str, name: object) -> None:
            if kind not in ALLOWED_KINDS:
                return
            # A new resource is not a continuation of the previous video's
            # percentage. Never sum segment percentages or infer completion.
            self.resource_kind = kind
            self.resource_name = safe_resource_title(name)
            self.percent = None
            self.last_snapshot = None
            self.publish()

        def publish(self) -> None:
            observation = (
                self.percent, self.resource_index, self.resource_total,
                self.resource_kind, self.resource_name,
            )
            if observation == self.last_snapshot:
                return
            self.root.mkdir(parents=True, exist_ok=True)
            data = {
                "v": 1, "token": self.token,
                "videoSegmentPercent": self.percent,
                "resourceIndex": self.resource_index,
                "resourceTotal": self.resource_total,
                "resourceKind": self.resource_kind,
                "resourceName": self.resource_name,
                "at": time.time(),
            }
            temporary: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w", encoding="utf-8", dir=self.root,
                    prefix="monitor-zhs-write-", suffix=".tmp", delete=False
                ) as stream:
                    temporary = Path(stream.name)
                    json.dump(data, stream, separators=(",", ":"), ensure_ascii=False)
                os.replace(temporary, self.path)
                self.last_snapshot = observation
            finally:
                if temporary is not None:
                    try:
                        temporary.unlink(missing_ok=True)
                    except OSError:
                        pass

    return ResourceMonitor()
