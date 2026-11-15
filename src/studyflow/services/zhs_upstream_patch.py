"""Deterministic, fail-closed reliability fixes for a staged ZHS 0.1.5 package.

The installed pip distribution and archived legacy sources are never edited.
Only a build-local copy is modified. No protocol, payload or playback rate changes.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
from pathlib import Path
import shutil

PATCH_ID = "studyflow-zhs-reliability-20261115-v1"
MARKER = "STUDYFLOW_ZHS_RELIABILITY_PATCH = " + repr(PATCH_ID)
UPSTREAM_GIT_BLOBS = {
    "ai/video.py": "c86d8de2f18b66c3a74921a35211ef0f6f1bf789",
    "ai/course.py": "eb00513cfe4c8b369009f2469296b6fa5b8b1618",
    "hike/video.py": "8eacfc4001408066b17f5a1e07831db2b99382fe",
    "zhidao/video.py": "03261b9497df2108e5151d100fca2af469a28551",
}


class UnsupportedUpstream(RuntimeError):
    pass


def git_blob_sha(source: str) -> str:
    canonical = source.replace("\r\n", "\n").encode("utf-8")
    return hashlib.sha1(b"blob " + str(len(canonical)).encode("ascii") + b"\0" + canonical).hexdigest()


def once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise UnsupportedUpstream(f"{label}: expected 1 source anchor, found {count}")
    return source.replace(before, after, 1)


def transform(name: str, source: str) -> str:
    """Make a tightly scoped patch against exactly one reviewed upstream source."""
    if name not in UPSTREAM_GIT_BLOBS:
        raise UnsupportedUpstream(f"Unexpected ZHS path: {name}")
    if MARKER in source:
        raise UnsupportedUpstream(f"Already patched; only fresh upstream accepted: {name}")
    if git_blob_sha(source) != UPSTREAM_GIT_BLOBS[name]:
        raise UnsupportedUpstream(f"ZHS 0.1.5 source differs from reviewed tag: {name}")
    result = source.replace("\r\n", "\n")
    if name == "ai/video.py":
        result = once(
            result,
            "            self._report_video_progress(course_id, class_id, file_id, knowledge_id, played_time)\n",
            "            if not self._report_video_progress(course_id, class_id, file_id, knowledge_id, played_time):\n"
            '                raise RuntimeError("ZHS_AI_PROGRESS_UNCONFIRMED")\n',
            name,
        )
        result = once(
            result,
            "            time.sleep(2)\n\n        wipe_line()",
            "            if played_time < end_at:\n                time.sleep(2)\n\n        wipe_line()",
            name,
        )
    elif name == "hike/video.py":
        result = once(result, "        while played_time <= end_time:\n", "        while played_time < end_time:\n", name)
        result = once(
            result, "        interval = 30\n\n        while",
            '        interval = 30\n        last_attempt = float("-inf")\n\n        while', name,
        )
        result = once(
            result,
            "            if played_time >= end_time or not (int(played_time - prev_time) % interval):\n",
            "            if (played_time >= end_time or played_time - prev_time >= interval) and (\n"
            "                time.monotonic() - last_attempt >= 5.0\n"
            "            ):\n"
            "                last_attempt = time.monotonic()\n",
            name,
        )
        result = once(
            result,
            "                    prev_time = ret_time\n",
            "                    prev_time = max(prev_time, ret_time)\n",
            name,
        )
        result = once(
            result,
            "        wipe_line()\n\n        # 人类延迟\n",
            '        if prev_time < end_time:\n'
            '            raise RuntimeError("ZHS_HIKE_PROGRESS_UNCONFIRMED")\n'
            "        wipe_line()\n\n        # 人类延迟\n",
            name,
        )
    elif name == "zhidao/video.py":
        result = once(
            result,
            "        # 显示最终进度（保留进度条在底部，不换行不清除）",
            '        if last_submit < played_time:\n'
            '            raise RuntimeError("ZHS_SHARED_PROGRESS_UNCONFIRMED")\n'
            "\n        # 显示最终进度（保留进度条在底部，不换行不清除）",
            name,
        )
        result = once(
            result,
            '            exc_msg = str(exc)\n            if "-10" in exc_msg:',
            "            if isinstance(exc, ApiError) and exc.code == -10:",
            name,
        )
        result = once(
            result,
            '            elif "-8" in exc_msg:',
            "            elif isinstance(exc, ApiError) and exc.code == -8:",
            name,
        )
    elif name == "ai/course.py":
        result = once(
            result,
            "        is_direct_mode = direct_target is not None\n",
            "        is_direct_mode = direct_target is not None\n"
            "        failed_knowledge_points = 0\n",
            name,
        )
        result = once(
            result,
            "                if no_homework:\n"
            "                    self._run_play_only(course_id, class_id, target.knowledge, video_player, learn_optional, threshold)\n",
            "                if no_homework:\n"
            "                    if self._run_play_only(course_id, class_id, target.knowledge, video_player, learn_optional, threshold) is False:\n"
            "                        failed_knowledge_points += 1\n",
            name,
        )
        result = once(
            result,
            "        self._reporter.print()\n        if is_direct_mode:\n",
            "        self._reporter.print()\n"
            "        if failed_knowledge_points:\n"
            '            self._reporter.print(msg_error(f"{failed_knowledge_points} 个知识点未确认完成"))\n'
            "            return\n"
            "        if is_direct_mode:\n",
            name,
        )
        result = once(
            result,
            '    ) -> None:\n        """play 模式：只刷知识点，不查询作业"""',
            '    ) -> bool | None:\n        """play 模式：只刷知识点，不查询作业"""',
            name,
        )
        result = once(
            result,
            '            logger.error(f"获取资源列表失败: {e}")\n            return\n',
            '            logger.error(f"获取资源列表失败: {e}")\n            return False\n',
            name,
        )
        result = once(
            result,
            "        total = len(resources)\n        for idx, resource in enumerate(resources, 1):\n",
            "        total = len(resources)\n        resource_failures = 0\n        for idx, resource in enumerate(resources, 1):\n",
            name,
        )
        result = once(
            result,
            '            except Exception as e:\n                logger.error(f"处理资源失败: {e}")\n',
            '            except Exception as e:\n                resource_failures += 1\n                logger.error(f"处理资源失败: {e}")\n',
            name,
        )
        result = once(
            result,
            '        logger.info(f"知识点完成: {knowledge.knowledge_name}")\n',
            '        if resource_failures:\n'
            '            logger.warning("知识点 {} 存在 {} 个未确认资源", knowledge.knowledge_name, resource_failures)\n'
            '            self._reporter.tree_print(msg_error(f"知识点未确认完成: {knowledge.knowledge_name}"), depth=3, enabled=True)\n'
            '            return False\n'
            '        logger.info(f"知识点完成: {knowledge.knowledge_name}")\n',
            name,
        )
        result = once(
            result,
            '        self._reporter.tree_print(msg_done(f"知识点完成: {knowledge.knowledge_name}"), depth=3, enabled=True)\n',
            '        self._reporter.tree_print(msg_done(f"知识点完成: {knowledge.knowledge_name}"), depth=3, enabled=True)\n'
            "        return True\n",
            name,
        )
    result = result.rstrip("\n") + "\n\n" + MARKER + "\n"
    compile(result, name, "exec")
    return result


def package_path() -> Path:
    if importlib.metadata.version("zhs") != "0.1.5":
        raise UnsupportedUpstream("Require exactly zhs==0.1.5")
    spec = importlib.util.find_spec("zhs")
    if not spec or not spec.origin:
        raise UnsupportedUpstream("ZHS package not found")
    return Path(spec.origin).resolve().parent


def prepare(stage_root: Path) -> None:
    root = package_path()
    # Never rewrite the pip package. The copy is private to this build.
    stage_root = stage_root.resolve()
    if stage_root.name != "zhs-stage" or stage_root.parent.name != "build":
        raise UnsupportedUpstream("Only build/zhs-stage is a supported staging location")
    staged = stage_root / "zhs"
    if staged.exists():
        shutil.rmtree(staged)
    stage_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(root, staged, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    planned: dict[Path, str] = {}
    for name in UPSTREAM_GIT_BLOBS:
        target = staged / name
        planned[target] = transform(name, target.read_text(encoding="utf-8"))
    for path, text in planned.items():
        path.write_text(text, encoding="utf-8", newline="\n")
    check(stage_root)


def check(stage_root: Path) -> None:
    for name in UPSTREAM_GIT_BLOBS:
        p = stage_root / "zhs" / name
        source = p.read_text(encoding="utf-8")
        if not source.rstrip().endswith(MARKER):
            raise UnsupportedUpstream(f"Patch marker missing: {name}")
        compile(source, str(p), "exec")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "check"))
    parser.add_argument("stage", type=Path)
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(args.stage)
    else:
        check(args.stage)
    print(f"[ZHS_PATCH_OK] {PATCH_ID} ({args.action})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
