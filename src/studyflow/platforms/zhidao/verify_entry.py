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

    from .upstream import zhidao_only
    key = args[0]
    rows = zhidao_only.read_cache(zhidao_only.COURSES).get("courses", [])
    if not isinstance(rows, list):
        return 2
    matches = [
        row for row in rows
        if isinstance(row, dict) and row.get("courseType") in ("ai", "shared")
        and zhidao_only.progress_key(row) == key
    ]
    if len(matches) != 1:
        return 2
    selected = matches[0]
    course_id = str(selected.get("courseId") or "")
    class_id = str(selected.get("classId") or "")
    return zhidao_only.verify_one(str(selected["courseType"]), course_id, class_id)


if __name__ == "__main__":
    raise SystemExit(main())
