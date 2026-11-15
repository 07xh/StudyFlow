"""Compatibility exports for the original read-only course helpers.

Keep existing StudyFlow imports stable while the isolated original reader and
sidecar use one implementation of course identity and stale-cache handling.
"""
from .diagnostics import ResponseShapeError
from .upstream.zhidao_courses import (
    identity,
    merge_source_lists,
    official_learning_url,
    progress_key,
    source_type,
)

__all__ = [
    "ResponseShapeError",
    "identity",
    "merge_source_lists",
    "official_learning_url",
    "progress_key",
    "source_type",
]
