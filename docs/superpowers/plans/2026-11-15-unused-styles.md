# Unused UI styles cleanup

> Implementation: execute inline; review the final diff independently.

**Goal:** Remove obsolete CSS whose required classes cannot be emitted by the current UI.

**Architecture:** Build on cleanup PR #116. Remove only unused selectors from `frontend/src/style.css` and `frontend/src/ui/foundation.css`; preserve all declarations on surviving selectors and preserve their cascade order.

**Tech Stack:** React, TypeScript, CSS, Vite, Python; PostCSS for the one-time cleanup.

**Spec:** This document records the scope of the requested code cleanup.

## Constraints and review focus

- Preserve behavior, UI layout, version numbers, backend, upstream snapshots, playback and progress logic.
- Search all TS/TSX sources before removing a class; preserve dynamically generated `sf-provider-*` and `is-*` classes.
- In grouped selectors, remove only obsolete members, retaining every live member and its declarations.
- Remove empty media queries and comments that only describe deleted rules.
- Check light/dark themes and 1280/960/720px layouts against the pre-cleanup render.

## Tasks

- [x] Inspect PR #116 and run baseline Python/frontend tests and production build.
- [x] Enumerate and review unused selectors, including dynamic class expressions. Baseline PR #116 browser smoke passed in CI. Local Chromium cannot launch because the environment blocks its socket creation; run the follow-up browser check in CI.
- [x] Remove obsolete selectors from the two stylesheets without reordering surviving rules (102 selectors, 38 unused class names; preserve 12 grouped rules).
- [x] Run regression tests and production build: Python 274 passed, frontend 166 passed, TypeScript/Vite build passed, `git diff --check` passed. A PostCSS comparison confirms every surviving selector, declaration, media context and cascade position is unchanged. Minified CSS: 114.43 kB → 105.96 kB (gzip 18.48 kB → 17.31 kB). Browser layout checks remain a CI requirement; no local visual comparison is claimed.
- [x] Independently review the diff: no blocking findings. PR #116 merged while this pass was being verified; deliver the additional styles cleanup in a separate follow-up PR.
