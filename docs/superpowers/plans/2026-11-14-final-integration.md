# StudyFlow final integration

Goal: integrate the four pending follow-ups and close verified gaps without modifying original executors.
Architecture: retain React → Tauri → frozen Python IPC and original vendor sources. Keep settings and updater artifacts within StudyFlow's per-user directory.

- [x] Merge feature audit, compact navigation, course workspace and duplicate-resource cleanup locally; run existing frontend checks.
- [ ] Reproduce and fix old-install settings writes and stale course selection after logout; retain read compatibility with old settings.
- [ ] Add frozen-runtime validation for original YKT module imports, original config and every ZHS worker import, plus a clean-settings JSONL probe during Windows packaging.
- [ ] Connect existing update discovery/download service through bounded IPC to settings UI; store A/B and channel preferences, verify release asset SHA-256, provide downloaded-file access. No release exists yet; show that state accurately.
- [ ] Run full Python/UI/build verification, review integration, publish PR, wait for Windows packaging and merge validated changes. Record actual platform/Windows account limitations.

Review focus: no credentials or synthetic course data in tests/UI; no original executor changes; no writes to old installation; no stale course controls after clearing identity; no arbitrary download destinations or installer execution from release notes.
