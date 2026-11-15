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
def scoped_upstream_play(options: dict | None, is_ai: bool, on_resource=None, target_resource=None):
    if options is None:
        yield
        return
    selected = set(options["selected_ids"])
    scoped = options["scope_mode"] == "selected"
    maximum = options["max_videos"]
    stop_on_error = options["stop_on_error"]
    resource_mode = options.get("resource_mode", "all")

    if not is_ai and resource_mode == "reading":
        raise ScopeInvalid()

    if is_ai:
        from zhs.ai.course import AiCourseManager
        from zhs.ai.video import AiVideoPlayer

        original_targets = AiCourseManager._iter_targets
        original_video = AiVideoPlayer.play_video
        original_resource = getattr(AiCourseManager, "_process_resource", None)
        original_list = getattr(AiCourseManager, "list_knowledge_resources", None)
        count = 0

        def resource_kind(item):
            detail = getattr(item, "resources_detail", None)
            key = (getattr(detail, "resources_type", None),
                   getattr(detail, "resources_distribute_type", None))
            if key in ((1, 3), (2, 2)):
                return "video"
            if key == (1, 4):
                return "ppt"
            if key == (2, 1):
                return "article"
            return "other"

        def process_resource(manager, course_id, class_id, knowledge_id, item, *args, **kwargs):
            if target_resource is not None and (
                knowledge_id, getattr(getattr(item, "resources_detail", None), "resources_uid", None)
            ) != target_resource:
                return None
            kind = resource_kind(item)
            if resource_mode == "video" and kind != "video":
                return None
            if resource_mode == "reading" and kind not in ("ppt", "article"):
                return None
            detail = getattr(item, "resources_detail", None)
            # The upstream may skip already-completed or optional resources.
            # Those are NOT an active video/PPT/reading item in the UI.
            optional_enabled = args[2] if len(args) > 2 else kwargs.get("learn_optional", False)
            active = getattr(item, "study_status", None) != 1 and (
                getattr(detail, "resources_sync_type", 1) == 1 or optional_enabled is True
            )
            if active and on_resource is not None:
                try:
                    on_resource(kind, getattr(detail, "resources_name", None))
                except Exception:
                    # UI-only callbacks must not change original ZHS flow.
                    pass
            return original_resource(manager, course_id, class_id, knowledge_id, item, *args, **kwargs)

        def list_resources(manager, course_id, class_id, knowledge_id):
            resources = original_list(manager, course_id, class_id, knowledge_id)
            if target_resource is not None and knowledge_id == target_resource[0]:
                if not any(r.resources_detail.resources_uid == target_resource[1] for r in resources):
                    raise ScopeInvalid()
            return resources


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
        if callable(original_resource):
            AiCourseManager._process_resource = process_resource
        if target_resource is not None and callable(original_list):
            AiCourseManager.list_knowledge_resources = list_resources
        try:
            yield
        finally:
            AiCourseManager._iter_targets = original_targets
            AiVideoPlayer.play_video = original_video
            if callable(original_resource):
                AiCourseManager._process_resource = original_resource
            if target_resource is not None and callable(original_list):
                AiCourseManager.list_knowledge_resources = original_list
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
            was_limited = maximum > 0 and len(chosen) < len(eligible)
            result = original_course(player, rac_id, ctx)
            if was_limited:
                raise ScopeLimitReached()
            return result

        def video(player, *args, **kwargs):
            # In shared courses the upstream video model already has the real
            # title. Observe it without querying additional endpoints.
            if on_resource is not None:
                video_id = args[1] if len(args) > 1 else kwargs.get("video_id")
                ctx = args[2] if len(args) > 2 else kwargs.get("ctx")
                try:
                    resource = getattr(ctx, "videos", {}).get(video_id)
                    if resource is not None and getattr(resource, "watch_state", None) != 1:
                        on_resource("video", getattr(resource, "name", None))
                except Exception:
                    # Local display instrumentation never interrupts playback.
                    pass
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
