# StudyFlow information hierarchy repair

Goal: implement the user-approved UI audit: global settings, platform configuration, course content and executor runs must have explicit ownership.

Architecture: retain the three-region header and permanently visible slim navigation. Keep the original Tauri/Python executors intact. Reorganize existing React controls; derive run and evidence views from current IPC responses, and record scoped local events without inventing server progress or history.

Constraints: no demo data in product; preserve all original execution options and platform-specific login; folded monitors stay mounted; unknown progress stays unknown; no cross-course stop controls or playback observations.

## Tasks

- [x] Scope official/ZHS observations and stop controls to their actual course/run. Add actual-component regressions for viewing B while A runs, switching runs and missing identity. Add metric/evidence and scoped event helpers with backward-compatible activity history.
- [x] Move player defaults, runtime preparation and account maintenance into the owning platform; move legal/about material to global settings. Separate Rain Classroom content from login, remove its platform-batch executor from course pages. Keep all 12 original options and mark saved defaults as next-launch values.
- [x] Replace task shortcuts with real executor status; show actual local execution/verification history in records and scope course logs. Put task actions before long chapter lists. Make header context, metric, timestamp and connection refresh explicit. Remove empty progress tracks and consolidate visual hierarchy.
- [ ] Run Python, UI/IPC and production builds; independently review the combined changes; fix material findings. Preserve original source snapshots and publish a reviewable branch/PR with Windows CI when authorized.

## Review focus

Course/run mismatch, unknown IDs, exited processes, stale requests after navigation, historical unscoped events, platform-batch boundaries, settings taking effect only on the next launch, and preserved login/data-cleanup actions.

User approval: the preceding comprehensive UI audit and placement table were accepted with “可以，开始修复”. Work proceeds inline without another design approval round.

## Verification ledger

- Actual official-player component reproduction failed before the course ownership fix and passes afterward, including navigation from A to B.
- Local Python regression: 167 passed. UI/IPC regressions: 59 passed. TypeScript/Vite production build passed.
- Review found that original ZHS status had no run identity. Native supervision now assigns a separate non-secret UUID, preserving the private observer nonce. Both stop commands verify expected run identity while holding the process-manager lock. All UI stop callers pass it. A frontend native-argument regression failed before the fix and passes afterward; Rust guard tests are part of the Windows build (no local Rust compiler is available).
- Task history remains local and backward compatible; historical records without course attribution stay in platform/global history. Run parameters are copied only from known non-credential settings used for that launch.
- A browser smoke script and CI step check 1280/960/720px empty-account layouts at 125% scale and retain screenshots. No local desktop/browser screenshot or real account acceptance has been claimed.
- Original legacy platform and Python business sources remain unchanged. Native changes are limited to process identity and atomic stop validation.
- One read-only reviewer inspected production modules and raised the run-identity issue, then became unavailable. Remaining settings/async paths were reviewed inline. Windows/package verification remains pending until the actual workflow result.

## Browser verification

Real Chromium CI checks passed at 1280/960/720 CSS pixels and device scale 1.25. Reviewed empty-account screenshots at minimum width and both themes. Follow-up visual repairs remove duplicated page headings, use the header for actual course selection, collapse account forms by default while honoring saved choices, normalize content inputs, and keep notifications in document flow. Initial browser failure was a deterministic-test setup error (app defaults to dark); it was corrected without changing the product theme default. Stable captures use reduced motion and an unfocused pointer.

An earlier revision completed Windows Rust/package/install smoke successfully. Current release eligibility remains tied to all checks on the final head, not to that earlier result.
