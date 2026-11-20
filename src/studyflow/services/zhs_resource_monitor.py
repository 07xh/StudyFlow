"""StudyFlow-only, read-only ZHS resource context for the local task panel.

The vendored ZHS 0.1.5 console observer stays unchanged. This subclass is
instantiated only by the StudyFlow worker and publishes resource identity from
already fetched ZHS Resource models. It never invokes progress/report endpoints.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import tempfile
import time

# ZHS 0.1.5 formats differ: AI prints "playing [bar] 12.3%", while
# shared courses print "playing VIDEO_ID [bar] 12.3%". The immutable vendor
# observer recognizes the former; this adapter observes only the latter.
_SHARED_VIDEO_PROGRESS = re.compile(
    r"^playing\s+([1-9][0-9]{0,19})\s+\[[^\r\n]{0,512}\]\s*"
    r"(\d{1,3}(?:\.\d{1,3})?)%", re.IGNORECASE,
)
# Terminals may repaint a worker's progress line with cursor/erase CSI
# commands before `playing`. Strip CSI control sequences, not arbitrary
# printable text; the accepted frame must still start with a video marker.
_ANSI_CSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")

# The original numeric observer accepts one decimal place for AI videos.
# Accept extra display precision here, but only for an anchored playing frame.
_AI_VIDEO_PROGRESS = re.compile(
    r"^playing\s+\[[^\r\n]{0,512}\]\s*"
    r"(\d{1,3}(?:\.\d{1,3})?)%", re.IGNORECASE,
)
# ZHS uses these labels while a video is paused or at an interaction.
# The percentage displayed in these modes is NOT a playback position.
_CONTROL_PHASE = re.compile(
    r"^(pause|answering)\s+\[[^\r\n]{0,512}\]\s*"
    r"(\d{1,3}(?:\.\d{1,3})?)%", re.IGNORECASE,
)

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
            self.playback_phase: str | None = None

        def receive(self, chunk: str) -> None:
            # Keep the original vendor monitor for resource counters and the
            # one-decimal AI format. This is only an additional read-only parser.
            # Read the last CR/LF frame to avoid borrowing another video's %
            # from earlier console chatter, and strip only terminal CSI codes.
            latest = re.split(r"[\r\n]", _ANSI_CSI.sub("", chunk[-4096:]))[-1].lstrip(" \t")
            playing = _SHARED_VIDEO_PROGRESS.match(latest) or _AI_VIDEO_PROGRESS.match(latest)
            percent = float(playing.group(2 if playing.re is _SHARED_VIDEO_PROGRESS else 1)) if playing else None
            valid_video = (
                percent is not None and 0.0 <= percent <= 100.0
                and self.resource_kind in (None, "video")
            )
            if valid_video:
                self.playback_phase = "playing"
            super().receive(chunk)
            if valid_video and (self.percent != percent or self.last_snapshot is None):
                # Shared-course formats and extra fractional precision are
                # not accepted by the immutable vendor NumericTelemetry.
                self.percent = percent
                self.publish()
            elif not valid_video and self.resource_kind in (None, "video"):
                control = _CONTROL_PHASE.match(latest)
                if control is not None and 0.0 <= float(control.group(2)) <= 100.0:
                    phase = "paused" if control.group(1).lower() == "pause" else "answering"
                    if self.playback_phase != phase or self.percent is not None or self.last_snapshot is None:
                        # Do not reuse the last playing % as a fresh sample
                        # while the original console says pause/answering.
                        self.playback_phase = phase
                        self.percent = None
                        self.last_snapshot = None
                        self.publish()

        def mark_resource(self, kind: str, name: object) -> None:
            if kind not in ALLOWED_KINDS:
                return
            # A new resource is not a continuation of the previous video's
            # percentage. Never sum segment percentages or infer completion.
            self.resource_kind = kind
            self.resource_name = safe_resource_title(name)
            self.playback_phase = None
            self.percent = None
            self.last_snapshot = None
            self.publish()

        def publish(self) -> None:
            observation = (
                self.percent, self.resource_index, self.resource_total,
                self.resource_kind, self.resource_name, self.playback_phase,
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
                "playbackPhase": self.playback_phase,
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
