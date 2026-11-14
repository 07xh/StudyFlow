# StudyFlow final integration

Goal: finish the existing StudyFlow integration without replacing either original executor.
Architecture: React → Tauri → frozen Python IPC; preserve the original ZHS 0.1.5 and Rain Classroom source/runtime.

- [x] Merge feature audit, compact floating navigation, platform-owned login, course workspace and duplicate-resource cleanup; run frontend checks.
- [x] Keep legacy settings migration read-only: read the old ZHS player preference when no StudyFlow copy exists, but write all changes only to the StudyFlow per-user directory.
- [x] Clear selected course context when either platform session/cache is invalidated; do not leave a stale detail workspace after logout.
- [x] Verify the frozen ZHS CLI/login/course imports, bundled numeric progress observer, original Rain Classroom module/config imports, and both platforms' settings JSONL handlers without contacting school servers.
- [x] Connect update discovery/download through bounded IPC; persist A/B and channel preferences, verify the unique Windows x64 Release asset SHA-256, and expose the downloaded update directory. No Release is treated as available until one is actually published.
- [ ] Finish Windows NSIS build, install/upgrade/launch/uninstall smoke, preserve-user-data check, and artifact upload.
- [ ] Review and merge the validated PR; publish a Release only after Windows and real-account verification.
- [ ] Record the remaining real-account acceptance steps: QR login, real course sync, Rain Classroom session validation and original-client coexistence.

Review focus: no credentials or synthetic course data in UI/tests; original executors unchanged; no writes into the old installation; no stale course controls after logout; no arbitrary download destination or installer execution from release notes.
