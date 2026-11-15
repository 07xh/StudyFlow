# Zhidao Same-course Concurrency Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** 同课最多三路独立视频执行与可操作的逐视频进度。

**Architecture:** 现有 Rust 平台任务保留一个监督进程。Python 监督进程读取实时课程，分配精确视频目标到独立 sidecar 子进程，并原子发布受限 JSON 状态；Rust 校验后交给 React 展示。

**Tech Stack:** Python 3.13 / ZHS 0.1.5 / Rust Tauri / React TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-15-zhidao-concurrency-design.md`

## Global Constraints

- 默认 2 路，范围 1–3；旧配置迁移为 1 路；不开放跨课并发。
- 不改发送算法；精确资源隔离；服务端证据与本地退出分开。
- 单项停止绑定运行身份；全停止清理子进程；父死子停。

## Review Focus

- 切换账号后子任务不得使用旧课程：每次启动重新解析当前会话课程。
- AI 同知识点多视频必须分开：使用资源 UID 精确限制。
- 快速连续停止/旧 runId 不得操作新任务。
- 过期遥测不得继续显示实时数值。
- 部分子进程失败或启动失败不得漏清理其余进程。

### Task 1: Settings and precise target catalog

Files: `zhs_settings.py`, new `services/zhs_queue.py`, `zhs_scope.py`, tests.
Interfaces: `concurrency: int`; `QueueTarget` with resource ID / optional knowledge ID / kind / safe name; `discover_targets(course, options)` uses current session and readers; `scoped_upstream_play(..., target_resource=None)` rejects nonmatching resources.
- [x] Write failing settings migration/bounds and exact target split/scope tests; run to RED.
- [x] Implement defaults, migration, catalog and exact resource restriction; run to GREEN.
- [x] Commit settings/catalog changes.

### Task 2: Supervisor and packaged workers

Files: new `services/zhs_queue.py`, `legacy_playback.py`, `packaging/bridge_entry.py`, tests.
Interfaces: `run_queue(course_key, token, options)` returns process status; atomic queue snapshot and per-row stop files keyed by run token; child mode receives exact target + options and monitors stdin EOF.
- [x] Write subprocess tests for two simultaneous workers, refill, failure isolation, serial nonvideo barriers and stop; run to RED.
- [x] Implement supervisor, packaged/source launch, worker parent watchdog and child target invocation; run to GREEN.
- [x] Run Python suite and commit.

### Task 3: Native status and frontend controls

Files: new `src-tauri/src/zhs_queue.rs`, `legacy_tasks.rs`, `lib.rs`, `legacyPlayback.ts`, `ZhsTaskSettingsPanel.tsx`, new `ZhsQueuePanel.tsx`, `LegacyPlaybackPanel.tsx`, UI tests.
Interfaces: optional `zhs_queue` in legacy status; rows include opaque ID, kind, name, state and optional fresh local percent; command `zhs_queue_stop_video(expected_run_id, task_id)`.
- [x] Write failing parser/IPC/UI tests for stale identity, per-video rows and stop action.
- [x] Add bounded native parsing, identity-checked controls, settings and accessible independent progress bars.
- [x] Run full Python/Node suites, frontend build and native checks available in environment; review and commit.
- [x] Push feature branch and open reviewable PR; do not claim Windows or real-account success without evidence.
