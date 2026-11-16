# 第三方代码来源与许可 — 增量登记（学习通本地心跳 M3）

追加到仓库现有 `docs/LICENSE_PROVENANCE.md`，不覆盖既有条目。

| 来源 | 版本 / commit | 取用文件与符号 | 许可证 | 处理方式 |
| --- | --- | --- | --- | --- |
| `Samueli924/chaoxing` | `45d2106b16764231c2de2038fb042e71b23d878f`（2026-09-28） | `api/base.py` — `get_enc()`、`video_progress_log()`、`study_video()`、`RateLimiter`、`_refresh_video_status()`；`api/config.py` — `VIDEO_HEADERS` / `AUDIO_HEADERS` / `THRESHOLD`；`config_template.ini` — `speed` / `jobs`；`main.py` — 章节并发与速度参数 | **GNU GPL v3** | 按本项目数据模型与 Sidecar 架构重写为 `heartbeat.py` / `runner.py`；保留 MD5 拼串、参数集合、2s 限流、rt 回退；删除题库、通知、Captcha OCR、终端进度条 |
| `lispringing/SuperStar` | `1f93cd18b6738e88dc4138545a99e87145c19350`（2026-07-24） | `api/base.py` — `get_enc()` / `video_progress_log()` | 仓库根目录**未见 LICENSE 文件**；与上游同源派生 | 仅做算法一致性比对，未直接复制代码；主运行模块以 GPL v3 上游为准。公开发布前需向维护者确认许可状态 |
| `Samueli924/chaoxing`（v2 增量） | 同上 `45d2106b` | `api/base.py::study_video()` — `random.uniform(30, 90)` 上报间隔、`_recover_after_forbidden()` / `_refresh_video_status()` 的 403 刷新流程；`video_progress_log()` 的 job 字段命名 | **GNU GPL v3** | 重写为 `pacing.py`（`PacingPolicy` / `VideoStatus` / `calibrate_target`）与 `taskparse.py`（字段归一化）；保留随机间隔与只读 status 校准，删除 cookie 自动重登录、Captcha OCR、终端进度条 |
| `07xh/StudyFlow` `feat/xuexitong-unified-platform-20261116` | `f91f1d68` / `bf191f7` 之后 | `src/studyflow/platforms/xuexitong/adapter.py`、`settings.py`、`credentials.py`、`runner_port.py`、`src/studyflow/core/*` | 项目自有 | `settings.py` / `credentials.py` / `runner_port.py` / `core/*` 原样保留；`adapter.py` 仅替换 `list_video_tasks()` 的浅正则为共享平衡括号解析、字段改走 `taskparse.iter_media_cards()`，其余逻辑未动 |

## 随包文件

- `docs/licenses/GPL-3.0-Samueli924-chaoxing.txt` — GNU GPL v3 全文（35,149 字节，取自上游 `LICENSE`）。
- `docs/XUEXITONG_LOCAL_HEARTBEAT.md` — 算法、参数、状态分类、修改记录与验证矩阵。
- `docs/XUEXITONG_HEARTBEAT_INTEGRATION.md` — v2 应用级接线补丁与验收清单。

## 合规动作清单

1. 公开仓库保留本文件、GPL v3 全文与上述来源/修改记录。
2. 分发 Windows 安装包时，`legal/` 目录随包附上 GPL v3 全文及本增量登记。
3. `SuperStar` 许可状态未确认前，不将其代码并入分发产物；当前仅作为比对证据存放于 `research/upstream/`。
4. 若后续把 `heartbeat.py` 拆分进独立动态库或子进程，仍按 GPL v3 的完整对应源码要求提供源码。
