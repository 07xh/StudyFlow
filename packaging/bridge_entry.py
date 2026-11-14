"""PyInstaller entrypoint for the secure JSONL IPC or legacy playback process.

Legacy playback is invoked in a separate process by the trusted Rust host.
The original source remains verbatim under legacy/yuketang/main.py.
"""
import sys

from studyflow.services.bridge import main as bridge_main
from studyflow.services.legacy_playback import main as legacy_main


def main() -> int:
    if sys.argv[1:2] and sys.argv[1].startswith("--legacy-"):
        return legacy_main()
    if len(sys.argv) != 1:
        return 2
    return bridge_main()


if __name__ == "__main__":
    raise SystemExit(main())
