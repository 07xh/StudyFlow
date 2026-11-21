"""Run the zhidao mastery tests without pytest installed.

This machine cannot reach a PyPI index, so ``tests/test_zhs_mastery.py`` and
``tests/test_zhs_practice.py`` get a minimal ``pytest`` shim (``raises``,
``approx``, ``mark.parametrize``) and are executed directly:

    python scripts/run_zhs_tests.py

Exit code 0 means every collected ``test_*`` function passed.  When real pytest
is available, ``python -m pytest tests`` remains the canonical runner.
"""
from __future__ import annotations

import importlib.util
import sys
import traceback
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))


class _Raises:
    def __init__(self, expected: type[BaseException]) -> None:
        self.expected = expected
        self.value: BaseException | None = None

    def __enter__(self) -> "_Raises":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is None:
            raise AssertionError(f"DID_NOT_RAISE: {self.expected.__name__}")
        if not issubclass(exc_type, self.expected):
            return False
        self.value = exc
        return True


class _Approx:
    def __init__(self, expected: float, rel: float = 1e-6, abs_: float = 1e-12) -> None:
        self.expected = expected
        self.rel = rel
        self.abs = abs_

    def __eq__(self, other: object) -> bool:
        try:
            return abs(float(other) - self.expected) <= max(self.abs, self.rel * abs(self.expected))
        except (TypeError, ValueError):
            return NotImplemented

    def __repr__(self) -> str:
        return f"approx({self.expected!r})"


def _parametrize(argnames, argvalues, ids=None):
    if isinstance(argnames, (tuple, list)):
        names = [str(name).strip() for name in argnames]
    else:
        names = [name.strip() for name in str(argnames).split(",")]
    rows = list(argvalues)

    def decorate(func):
        func._params = (names, rows, ids)  # type: ignore[attr-defined]
        return func

    return decorate


def install_pytest_shim() -> None:
    module = types.ModuleType("pytest")
    module.raises = _Raises
    module.approx = _Approx
    module.mark = types.SimpleNamespace(parametrize=_parametrize)
    module.fixture = lambda *args, **kwargs: (args[0] if args and callable(args[0]) else (lambda f: f))
    sys.modules["pytest"] = module


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location(f"zhs_test_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    install_pytest_shim()
    wanted = ("test_zhs_mastery.py", "test_zhs_practice.py")
    files = [ROOT / "tests" / name for name in wanted if (ROOT / "tests" / name).exists()]
    if not files:
        print("no test files found")
        return 1

    passed = 0
    failed: list[str] = []
    for path in files:
        module = load_module(path)
        for name in sorted(dir(module)):
            if not name.startswith("test_"):
                continue
            func = getattr(module, name)
            if not callable(func):
                continue
            params = getattr(func, "_params", None)
            if params is None:
                cases = [(f"{path.stem}::{name}", ())]
            else:
                names, rows, ids = params
                cases = []
                for index, row in enumerate(rows):
                    label = ids[index] if ids else str(row[len(row) - 1])[:48]
                    cases.append((f"{path.stem}::{name}[{label}]", tuple(zip(names, row))))
            for label, kwargs in cases:
                try:
                    func(**dict(kwargs))
                except Exception:
                    failed.append(label)
                    print(f"[FAIL] {label}")
                    traceback.print_exc(limit=3)
                else:
                    passed += 1
                    print(f"[PASS] {label}")

    print()
    if failed:
        print(f"{len(failed)} failed, {passed} passed")
        return 1
    print(f"{passed} passed, 0 failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
