"""Dedicated-worker traversal controls for bundled ZHS 0.1.5.

Upstream heartbeat payloads, generators and transports remain unmodified.
All process-local patches are restored before returning to the caller.
"""
from __future__ import annotations

from contextlib import contextmanager


class ScopeLimitReached(BaseException):
    """Configured video count has been reached, not course completion."""


class ScopeFailed(BaseException):
    """Upstream video error and stop-on-error was requested."""


class ScopeInvalid(BaseException):
    """A selected identifier does not exist in the current upstream context."""


@contextmanager
def scoped_upstream_play(options: dict | None, is_ai: bool):
    if options is None:
        yield
        return
    selected = set(options["selected_ids"])
    scoped = options["scope_mode"] == "selected"
    maximum = options["max_videos"]
    stop_on_error = options["stop_on_error"]

    if is_ai:
        from zhs.ai.course import AiCourseManager
        from zhs.ai.video import AiVideoPlayer

        original_targets = AiCourseManager._iter_targets
        original_video = AiVideoPlayer.play_video
        count = 0

        def targets(manager, course_info):
            candidates = list(original_targets(manager, course_info))
            if scoped:
                available = {t.knowledge.knowledge_id for t in candidates}
                if not selected.issubset(available):
                    raise ScopeInvalid()
                candidates = [t for t in candidates if t.knowledge.knowledge_id in selected]
            return iter(candidates)

        def video(player, *args, **kwargs):
            nonlocal count
            if maximum and count >= maximum:
                raise ScopeLimitReached()
            try:
                result = original_video(player, *args, **kwargs)
            except Exception as exc:
                if stop_on_error:
                    raise ScopeFailed() from exc
                raise
            # Counts upstream calls that actually advanced a previously incomplete resource.
            if kwargs.get("schedule", 0) < kwargs.get("threshold", 100):
                count += 1
            if maximum and count >= maximum:
                raise ScopeLimitReached()
            return result

        AiCourseManager._iter_targets = targets
        AiVideoPlayer.play_video = video
        try:
            yield
        finally:
            AiCourseManager._iter_targets = original_targets
            AiVideoPlayer.play_video = original_video
    else:
        from zhs.zhidao.video import ZhidaoVideoPlayer
        from zhs.exceptions import CaptchaRequired, TimeLimitExceeded

        original_course = ZhidaoVideoPlayer.play_course
        original_video = ZhidaoVideoPlayer.play_video

        def course(player, rac_id, context):
            # Use fresh server-backed context rather than the UI's cached metadata.
            ctx = context.model_copy(deep=True)
            available = set(ctx.videos)
            if scoped and not selected.issubset(available):
                raise ScopeInvalid()
            eligible = set()
            for ch in ctx.chapters:
                for lesson in ch.video_lessons:
                    for item in lesson.video_small_lessons:
                        if scoped and item.video_id not in selected:
                            continue
                        if item.watch_state == 1:
                            continue
                        eligible.add(item.video_id)

            chosen = set()
            for ch in ctx.chapters:
                lessons = []
                for lesson in ch.video_lessons:
                    videos = []
                    for item in lesson.video_small_lessons:
                        if item.video_id not in eligible:
                            continue
                        if maximum and len(chosen) >= maximum and item.video_id not in chosen:
                            continue
                        chosen.add(item.video_id)
                        videos.append(item)
                    if videos:
                        lesson.video_small_lessons = videos
                        lessons.append(lesson)
                ch.video_lessons = lessons
            ctx.chapters = [ch for ch in ctx.chapters if ch.video_lessons]
            ctx.videos = {ident: item for ident, item in ctx.videos.items() if ident in chosen}
            return original_course(player, rac_id, ctx)

        def video(player, *args, **kwargs):
            try:
                return original_video(player, *args, **kwargs)
            except (CaptchaRequired, TimeLimitExceeded):
                raise
            except Exception as exc:
                if stop_on_error:
                    raise ScopeFailed() from exc
                raise

        ZhidaoVideoPlayer.play_course = course
        ZhidaoVideoPlayer.play_video = video
        try:
            yield
        finally:
            ZhidaoVideoPlayer.play_course = original_course
            ZhidaoVideoPlayer.play_video = original_video
