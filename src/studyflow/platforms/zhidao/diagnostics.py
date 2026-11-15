"""Compatibility exports for the original privacy-safe diagnostics.

Use the same exception class in the adapter and original reader, so either
entry point can handle response-shape errors without exposing response data.
"""
from .upstream.zhidao_diagnostics import (
    ResponseShapeError,
    diagnose,
    diagnostic,
    emit_failure,
)

__all__ = ["ResponseShapeError", "diagnose", "diagnostic", "emit_failure"]
