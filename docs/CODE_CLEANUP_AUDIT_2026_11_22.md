# StudyFlow 旧代码清理审查（2026-11-22）

基线：`main` 的 rc.62 整合提交 `aa34c801`，后续修改均置于独立清理分支，不覆盖已发布版本。

## 已核实且已整合的清理

- PR #214 整合了旧 `questionbank.yanxi.status/save/clear/query` IPC 的删除、共享题库中心重构，以及 `integration/frontend/XuexitongHeartbeatPanel.{tsx,css}` 两份重复副本的清理。
- 正式运行组件位于 `frontend/src/components/XuexitongHeartbeatPanel.{tsx,css}`；删除的是历史镜像，不是运行中的学习通组件。
- 旧 `yanxi.dpapi` 仍有一次性只读迁移入口 `yanxi._load_legacy_token()`，由 `question_bank._read()` 调用：先写入新加密保险库，再尝试移除旧文件。
- `questionbank.tokens.add` 仍是共享 IPC 兼容入口，不应因前端改用批量导入而删除服务端处理器。

## 本轮发现与修改

| 审查点 | 证据 | 处理 |
| --- | --- | --- |
| 通用题目校验依赖首个题库的专用工具 | `question_bank._question_field()` 调用 `yanxi._field()` | 改为独立的通用题干、题型和选项校验；保留已有字段边界 |
| 外部诊断原因可能含原始网络/凭据信息 | `check_token()` 直接截取任意 `report["reason"]` | 只允许内部约定的状态原因码；`_public()` 对已存旧元数据也做过滤 |
| 新增题库的通用 Token 格式错误提示缺失 | 前端仅映射言溪专属 Token 错误 | 增加 `QUESTIONBANK_INVALID_TOKEN` 文案，不反显 Token |
| README 仍标注 U校园 PR #151 为 Draft | PR #151 实际已合并 | 改为「代码已合并、真实账号待验」，不夸大功能 |
| 题库接入文档仍说清理只存在于 rc.61 之外的分支 | 代码已由 PR #214 合入 rc.62 | 更正版本说明，避免误读当前安装包状态 |

## 确认保留，不按旧文件名删除

- `legacy/zhidao/`：官方播放器脚本、许可证/源码出处、安装与旧配置兼容使用这些资源；具体删除前需逐文件检查打包路径和运行时调用链。
- `legacy/yuketang/`：原版 `main.py`、`exe_entry.py` 等用于独立运行时及参数兼容，不能当作纯废弃目录。
- `src-tauri/src/legacy_tasks.rs`、`src/studyflow/services/legacy_playback.py`、前端 `LegacyPlaybackPanel.tsx`：仍有原版任务管理用途；不能按 `legacy` 名称清理。
- `docs/RELEASE_CANDIDATE_*.md`：历史发布记录应保留，以便追溯变更与版本包。
- 旧 DPAPI 解密/迁移入口：即使新 UI 已不暴露旧操作，也须为从旧版本直接升级的用户保留。

## 待审查而未删除

- 各平台只读适配器和历史恢复模块：需要针对真实导入、构建脚本、测试入口及运行时引用逐项核对。
- 通用保险库 DPAPI 已在后续 PR #247 中独立至 `services/dpapi_storage.py`，保留原密文格式、Windows API 标志和旧言溪 Token 迁移入口；仍须完成 Windows 旧数据回读验收。
- 题库 Token 剩余额度来自最近一次接口响应，未被证实实时准确；清理不得误改成可靠的实时余额或自动重试。

## 验收边界

本轮只清理耦合、过时说明和 IPC 状态信息。Python 单元测试、React UI/IPC 测试及 Windows 构建检查通过，不等于第三方 Token/学业进度的真实在线验收。

## 后续清理（2026-11-23：U校园无前端入口的纯本地运行器）

- 旧 `UCampusHeartbeatPanel` 已从 UI 移除，但 Rust/Python 曾残留 `ucampus.heartbeat.*` 本地调度入口。本次将其从 Rust 白名单、JSONL IPC、前端请求类型和退出清理中一并删除。
- 将仍在使用的旧版 Socket.IO **只读诊断**迁入 `ucampus_socket_diagnostics.py`；将研究代码依赖的 `LocalPulse` 数据结构迁入 `pulse_types.py`，避免删运行器时破坏传输契约测试。
- 删除纯本地模拟运行器、原 bridge 与专属运行器测试，新增只读连接诊断和旧入口拒绝的回归检查。
- 保留四平台在线读取与官方进度回读、U校园只读监控、独立实验性网络模块、凭据与数据迁移、原版知到/雨课堂发送器。此 PR 经 Python/React/Windows 构建门禁后方可合并；本次清理不等同于任何第三方服务器的在线验收。

## 后续清理（2026-11-23：通用题库 DPAPI 与提供方解耦）

- `question_bank.py` 不再通过 `yanxi._dpapi()` 加解密共享 `providers.dpapi`，改为通用 `dpapi_storage.crypt()`。
- 旧 `yanxi.dpapi` 迁移仍经 `yanxi._load_legacy_token()`，保留 `yanxi._dpapi()` 兼容入口和原安全错误码。两个入口使用相同的 Windows 当前用户 DPAPI、原 `0x1` UI 禁止标志、既有文件格式与先写新保险库再删除旧文件的顺序。
- 离线测试覆盖共享保险库与提供方旧加密入口解耦、旧 Token 迁移、失败边界；生产 Windows 旧数据回读与升级仍需要安装包或真机验收。

## 第三批清理（2026-11-24：空包、过时元数据与文档）

- 删除仅有 `__init__.py` 占位说明、没有实际实现或入口的 Python `studyflow.ui`、`studyflow.storage` 包。当前运行 UI 为 `frontend/src/ui` React 实现，实际配置与凭据存储位于平台和服务模块；两者并非 Python 旧占位目录的实现。
- 更新 `pyproject.toml` 的项目描述为真实四平台；将知到/雨课堂 `__init__` 的「待迁移源码」旧说明更新为当前原版运行时适配事实；U校园模块说明明确为只读核验、Socket.IO 诊断、独立实验模块。
- 重写 `frontend/README.md`：旧文档仍声称 Windows EXE 未构建、知到 Cookie 导入未接线、仅 UI 基线，已改为实际 React/Tauri/sidecar 架构、四平台模块说明与浏览器预览/真实客户端的区分。
- 保留 `src/studyflow/core/platform_api.py` 通用只读适配器契约，以及 `frontend/src/ui` 活跃组件、原版运行器、历史兼容入口；不对仍受保护的运行路径做名称驱动删除。
- 代码变更继续以 GitHub Actions 的 Python / React / Windows 全流程回归为合并门禁，未执行真实账号联网验收。

## 第四批清理（2026-11-24：前端 WPF 旧样式和 Windows Sidecar 测试依赖）

- 已核对 `frontend/src/style.css` 的 WPF v5.2.9 配色与 `.nav` 覆盖由 `ui/foundation.css` 当前 LightC 桌面主题的更高特异性选择器接管；移除这一段已被覆盖的颜色、导航规则，保留焦点、课程详情、QR 对话框、原版任务和平台专有样式。
- 将仍被 `.legacy-run-state` 和当前 `foundation.css` 引用的 `--subtle` 变量迁至当前主题浅色/深色声明；扫描全部 13 个当前 `frontend/src/**/*.css` 后，确定 `--subtle-text` 无任何 `var(...)` 引用，删去该旧变量。增加 UI 样式回归测试防止重复覆盖复活。
- Windows PyInstaller 日志显示 `--collect-all keyring` 会解析 `keyring.testing` 和 `hook-pytest`；仅加入 `--exclude-module keyring.testing`、`--exclude-module pytest`，保留全部正式 `keyring` 后端、`zhs` 原版组件和原有 ZHS/YKT/U校园只读依赖探针，增加脚本契约测试。
- 修正文档中 U校园「凭据切换时重置两套运行器」的旧说法：现为实验运行器与只读监控，已退役的本地心跳运行器没有可重置实例。
- 本批更改在独立 PR #247，尚须针对最新提交分别核对 Python、React 和 Windows CI；未声称 Windows 安装包发布或平台真实账号验收。

## 第五批清理（2026-11-24：重复 CSS 规则）

- 精确核对 `ui/foundation.css` 的首次授权弹窗样式：删除重复的 `.sf-consent-header>div` 原样声明；`@media(max-width:600px)` 和 `@media(max-width:540px)` 同时设置相同 `padding:14px`，删除后者这一重复属性，保留全部断点和其余授权弹窗规则。
- `style.css` 全局 `.nav`、`.nav:hover`、`.nav.active` 旧配色及按钮默认值已被当前 `AppShell` 中 `.app.sf-shell` 下的 `foundation.css` 同名样式接管；删除单纯覆盖层，保留原 media 区域中的布局回退，避免误改低宽度导航行为。
- `obsoleteStylesFinal.test.cjs` 增加旧 WPF/旧导航规则不能回流、首次授权弹窗不能重复声明的回归检查。这个小范围清理不改变账号会话、进度读取、播放器或课程任务逻辑。
- 若 Windows 冻结测试依赖清理引发打包回归，则优先修复打包，不合并失败构建；GitHub Actions 的全平台结果须以本批 HEAD 为准。

## 第六批清理（2026-11-24：重复依赖清单与不可重复前端安装）

- 确认 `packaging/requirements.txt` 不属于受保护的原版来源清单，且不被当前 Python/Windows 打包脚本和当前非历史性功能文档使用；该文件缺少新 `pyproject.toml` 已声明的依赖，容易产生漂移，已删除。受保护的 `legacy/yuketang/requirements.txt` 完全保留。
- `frontend/package-lock.json` 的根版本、`dependencies` 与 `devDependencies` 已与 `frontend/package.json` 对齐；统一 PR `test.yml` 与 `scripts/build-windows.ps1` 前端依赖安装为 `npm ci`，主分支 `build-windows.yml` 已使用 `npm ci`，保持一致。
- 第六批时仓库根目录尚无 `package-lock.json`，因此当时保留 `npm install`；此缺口已在下方第八批通过实际 CI 生成两份锁文件解决，不再是当前限制。
- 新增 `tests/test_build_dependency_contract.py`，测试依赖单一来源、前端锁文件和各构建入口；不修改第三方 ZHS/YKT 原版发送逻辑、用户凭据与业务协议。
- 最新提交的完整 Python / React / Windows + NSIS 安装烟测需要独立重新通过，不以此前成功运行的 CI 代替新提交验收。

## 第七批清理（2026-11-24：CI 浏览器资源复用）

- PR 的 React 浏览器布局测试仍使用隔离安装的 `playwright@1.62.1`，每个新提交都会运行 Chromium 布局与键盘交互检查；此前每次新的 Linux runner 都需要重新下载完整浏览器，造成重复网络开销。
- 在 `.github/workflows/test.yml` 为 `~/.cache/ms-playwright` 增加 `actions/cache@v4`；缓存 key 绑定 Playwright 版本和 runner OS，升级 Playwright 时不复用过期浏览器。浏览器安装及 `browserHierarchy.cjs`、`browserSettings.cjs` 验收仍保留。
- `tests/test_build_dependency_contract.py` 增加 Playwright 版本与缓存 key 一致性校验。缓存首次命中前仍需下载，收益仅在后续执行并成功保存缓存后出现；此改动不是跳过浏览器测试。
- 保留前端 React 样式、TaskRecovery 状态与原版 ZHS/YKT 模块，避免为了减少文件个数破坏有效业务路径。

## 第八批清理（2026-11-24：根 npm 与 Rust 锁文件闭环）

- 在仅针对当前 PR 的临时 GitHub Actions Job 中，用 Node.js 22 的 `npm install --package-lock-only --ignore-scripts` 解析根目录 Tauri CLI 依赖，并用 Rust stable `cargo generate-lockfile --manifest-path src-tauri/Cargo.toml` 生成真实 `Cargo.lock`；完整性校验后将两份文件提交到 PR。没有伪造、简化或手写依赖数据。
- `package-lock.json` 记录了 Tauri CLI 的 Windows x64 可选二进制及校验数据；`src-tauri/Cargo.lock` 记录 444 个解析的 crate 依赖包。两份文件生成后，立即移除临时 CI 解析 Job 与日志输出，以免日常校验产生额外工作和内容输出。
- `scripts/build-windows.ps1` 的根级 `npm install` 正式切换为 `npm ci`；Rust 测试命令改为 `cargo test --locked`，前端继续使用 `npm ci --prefix frontend`。三处输入现在都有真实锁文件，而非只锁定 React 前端。
- `tests/test_build_dependency_contract.py` 增加根 npm manifest/lock、Windows x64 CLI、Cargo.lock、Rust `--locked`、临时任务移除等断言。是否真正可在 Windows 构建、升级并保留用户数据，以最新 HEAD 完整 CI 为准，不能以锁文件存在代替打包验收。
