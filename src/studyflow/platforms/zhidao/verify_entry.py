"""One-course read-only verification entrypoint for the packaged sidecar."""
from __future__ import annotations

import re
import sys
from typing import Sequence

COURSE_KEY = re.compile(r"^[a-f0-9]{64}$")


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1 or not COURSE_KEY.fullmatch(args[0]):
        return 2

    from .legacy_runtime import _session_course_cache
    from .courses import progress_key
    key = args[0]
    # Apply exactly the same current-login, completeness and cache-schema
    # checks as the UI bridge. A direct --zhidao-verify-one invocation must not
    # silently trust stale or partial course lists from another session.
    try:
        rows, _ = _session_course_cache()
    except (OSError, RuntimeError, ValueError):
        return 4
    matches = [
        row for row in rows
        if row.get("courseType") in ("ai", "shared")
        and progress_key(row) == key
        and row.get("stale") is not True
    ]
    if len(matches) != 1:
        return 2
    selected = matches[0]
    course_id = str(selected.get("courseId") or "")
    class_id = str(selected.get("classId") or "")
    # Import heavy ZHS-only dependencies after all local identity gates pass.
    from .upstream import zhidao_only
    return zhidao_only.verify_one(str(selected["courseType"]), course_id, class_id)


if __name__ == "__main__":
    raise SystemExit(main())
