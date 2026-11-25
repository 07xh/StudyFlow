# StudyFlow Windows 打包与真实数据验收

## 兼容性原则
- 旧仓库、旧 EXE、原版 WPF 界面和 Python 模块 **不覆盖、不删除**。
- 知到使用学序内置 ZHS 0.1.5 与只读课程 CLI，登录及扫码不再依赖旧 ZHSDesktop 安装目录。若安装了原版，其文件和账号数据必须保留不变。
- 雨课堂从当前用户提供的 Session ID、CSRF Token、课堂 ID、学校 ID 查询官方接口。新凭据存入 Windows Credential Manager，不写入源码和原版 .env。
- 新 UI 只读同步实际课程与视频元数据。没有服务器确认的进度显示为“暂无服务端确认数据”。

## 本地 Windows 11 构建
需要 Python 3.13、Node.js 22、Rust stable、Visual Studio C++ Build Tools 和 WebView2。执行：

\`\`\`powershell
powershell -NoProfile -File .\scripts\build-windows.ps1
\`\`\`

脚本依次安装已锁定的根目录与 React 依赖、运行 Python 测试、使用 PyInstaller 编译 sidecar、生成本项目图标、运行 Rust `cargo test --locked`，最后由 Tauri 2 的 `beforeBuildCommand` **只构建一次 React 前端**并打包 NSIS 安装程序。React 的独立 CI 构建检查仍保留。

输出目录：\`src-tauri/target/release/bundle/nsis/\`

## GitHub Actions 节省时间
- `workflow_dispatch` 可手动启动完整 Windows 打包；涉及打包的主分支提交亦可触发构建。
- Python 回归在 Pull Request、主分支 push 和手动触发时运行；主分支 Windows 打包与 React 前端门禁由独立的 Build Windows EXE 工作流负责。
- Pull Request 的 Windows 安装包验收使用 windows-latest，与主分支发布门禁对齐；安装、升级、正常退出、卸载以及原始数据保留均需通过。
- 只有工作流实际成功且上传 artifact 后，才能称为“Windows EXE 构建成功”；只有对应 GitHub Release 存在且含可安装的 NSIS 产物，才能称为“已发布”。

## 真实验收清单
1. 在**仅安装学序**的全新 Windows 用户环境中完成知到扫码登录；检测连接必须基于真实 `doctor-server` 服务器结果，不以 Cookie 文件存在当作登录成功。
2. 点击知到同步课程，核对 \`.zhs/zhidao-courses.json\` 的同会话 HMAC，确认不是旧账号数据。
3. 雨课堂输入自己的当前有效会话后保存，确认能获得课堂名和章节视频；错误会话必须不显示已连接。
4. 从界面同步课程、关闭重开软件、重复同步，确认原版程序仍能独立运行。
5. 安装和卸载新程序后确认原版 ZHSDesktop 和雨课堂文件不受影响。

## 当前尚未实测的事项
Windows 的冻结运行时与 NSIS 产物由 CI 检查，官方账号扫码及课程读取仍需在用户电脑上实际验证；离线 CI 不等于官方服务器认证成功。

## 最后接入检查（2026-11-14）

冻结后的 sidecar 增加 `--yuketang-env-check`，在临时目录中导入原版 main.py（不调用 main、不访问网络），验证 runpy 脚本依赖和原版配置入口均已打包。`--zhidao-env-check` 同时导入 CLI、课程、扫码和单课核验入口。两者失败均阻止 NSIS 打包。

知到历史官方播放器已退役，专属设置接口不再可用，安装包不再包含播放器启动脚本。旧 ZHSDesktop 及学序自己的 `official-player-settings.json` 保留原样，不读取、迁移或删除。Tauri 应用所需的 WebView2 不受影响。

## 冻结运行时精简与回归（2026-11-24）

- Windows sidecar 的 PyInstaller 收集规则仍保留 `keyring` 正式凭据后端及 `zhs` 原版依赖；排除只服务开发测试的 `keyring.testing`、`pytest` 模块。此次仅精简打包，不更改账号会话与业务协议。
- 保留 `--zhidao-env-check`、`--yuketang-env-check` 和 `--ucampus-socket-env-check`（只检查 Socket.IO 诊断依赖，不联网、不读取账号）；旧 `ucampus.heartbeat.capabilities` 入口必须返回 `UNKNOWN_OPERATION`。
- 精简有效性以 Windows CI 生成的可安装 NSIS、冻结 sidecar 检查、安装升级卸载烟测为准。构建依赖排除并不代表软件实际大小必然按比例下降，不能未经比较宣称体积收益。

## 依赖清单与前端可重复构建（2026-11-24）

- Python 安装与 PyInstaller 构建统一以 `pyproject.toml` 为依赖来源：`scripts/build-windows.ps1` 执行 `python -m pip install -e '.[desktop,dev]'`。已删除未被当前构建使用且依赖集合不完整的 `packaging/requirements.txt`。原版 `legacy/yuketang/requirements.txt` 受源码清单保护，必须保留。
- 前端已提交 `frontend/package-lock.json`，在 Windows 构建、PR CI 与主分支发布门禁中统一使用 `npm ci`，防止 `npm install` 意外重解版本。手动开发同样优先运行 `cd frontend; npm ci`。
- 根目录 `package-lock.json` 已由 CI 的 Node.js 22 环境生成并提交（包含 Windows x64 平台的 Tauri CLI 可选二进制），原本无锁文件的根级 `npm install` 已统一替换为 `npm ci`；前端同样使用自己的 `frontend/package-lock.json`。
- `tests/test_build_dependency_contract.py` 核对 Python 清单、前端锁文件与三处构建入口；这只能保证清单一致，是否能安装、打包和保留原数据仍由 Windows CI 与实机验收决定。

## 根目录与 Rust 锁文件验证（2026-11-24）

- 由 GitHub Actions 在真实 Node.js 22 / Rust stable 环境解析生成根目录 `package-lock.json` 和 `src-tauri/Cargo.lock`；均作为代码提交纳入 PR，**未手工臆造依赖记录**。
- Windows 构建脚本通过两次 `npm ci` 分别固定根 Tauri CLI 和 `frontend` React 依赖，并通过 `cargo test --locked --manifest-path src-tauri/Cargo.toml` 验证 Rust 清单与锁文件一致。
- 单元契约测试额外检查根 npm 包与依赖表、Windows x64 CLI 二进制记录、Cargo 依赖树及禁止重新引入一次性 CI 解析任务。依赖锁定能降低构建漂移，但无法冻结系统 SDK、第三方 API 或学校服务端行为。
- 对应 PR 的最新 Windows NSIS、安装/升级/卸载、React UI/IPC、Python 测试必须再次全部通过，才能视作构建依赖锁定完成验收。

## 前端重复编译清理（2026-11-24）

- Windows 成功构建日志证明，旧脚本先运行一次 `npm --prefix frontend run build`，随后 `npm run tauri -- build` 又根据 `src-tauri/tauri.conf.json` 中的 `beforeBuildCommand` 重复执行一次。
- 已删除 PowerShell 脚本中的首次冗余调用；Tauri 正式打包命令仍触发完整的 `tsc -b && vite build`，并在前端构建失败时直接使 Windows 打包失败。
- Python 构建契约测试检查脚本不再直接启动 React build、Tauri 配置仍包含正式 `beforeBuildCommand` 且 `npm ci` 保留；真实结果须以最新 Windows NSIS CI 为准，不能凭静态配置宣称运行时性能提升。

## 真正的旧版本升级与用户数据保留验收（2026-11-24）

- 旧版安装与同版本重装不是一回事。此前 CI 在同一临时目录中两次安装同一个 NSIS，只能验证覆盖重装，不能证明 `rc.65 → rc.66` 的真实升级。
- 新的 `scripts/fetch-previous-installer.ps1` 根据当前 `src-tauri/tauri.conf.json` 的 RC 版本自动解析紧邻的前一 RC，从 **07xh/StudyFlow 官方 GitHub Release** 下载唯一的 x64 安装包，校验官方 Release 的完整下载 URL 和 `sha256:` 摘要；哈希不匹配则立即失败。PR 和正式发布两个 Windows 工作流均先执行此检查。
- `scripts/test-windows-install.ps1` 收到 `STUDYFLOW_PREVIOUS_INSTALLER` 后先安装上一版到独立临时目录，然后使用当前构建安装包执行真正的跨版本升级，再做同版本覆盖重装、运行时 IPC 探针、后台锁定升级阻断、正常 UI 退出和卸载；本地无旧版安装包时明确标注只检查全新安装与同版本重装。
- 测试前创建随机非敏感保留标记，覆盖 `%LOCALAPPDATA%/StudyFlow` 根目录、`zhidao/`、`question-bank/`、`legacy-logs/`、`updates/`，以及原版 `ZHSDesktop` 安装数据目录和用户 `~/.zhs`。跨版本升级、同版本重装、被占用文件阻断、重试与卸载后均检查这些标记文件内容不变，最后只清理 CI 自己建立的文件。
- **验收边界**：这证明安装脚本在受控 Windows CI 用户下不会清空上述目录的测试文件，仍不能代替真实用户的 Windows Credential Manager、旧账户登录信息、真实课程缓存格式和第三方平台服务器数据升级验证。不得用合成文件标记声称真实用户数据已经全部迁移成功。

## 六轮 UI 重构收尾验收（2026-11-25）

#249–#254 均已合并至 main。最终通过的 PR #254 头提交 `0127fffa0fdbfe806b874758ab24bfa97442d930` 与最终合并提交 `2cdb9f6f309f02a6e376294fffa7426b116e72fe` 所含源码无文件差异；主分支独立 CI 结果尚未取得，不能将 PR CI 改称主分支 CI。

[StudyFlow validation #45512032707](https://github.com/07xh/StudyFlow/actions/runs/45512032707) 已完成且所有任务成功：
- Python 回归、React 生产构建及 UI/IPC 契约测试；
- 1280/960/720px、125% 缩放的浏览器布局，以及深浅主题、设置弹窗、键盘焦点恢复；
- Windows NSIS 0.1.1-rc.68 构建（日志显示安装包 43.12 MiB）；
- 官方 rc.67 安装包 SHA-256 验证、rc.67 → rc.68 跨版升级、同版重装、启动、卸载及测试数据标记保留。
- 安装包 artifact 为 `StudyFlow-standalone-Zhidao-NSIS`（14977205672）。此为 CI 构建产物，不是新的正式发行声明。

### 真机验收记录（尚未执行）

| 检查项 | 通过标准 | 状态 |
| --- | --- | --- |
| 真实用户安装/升级 | 启动正常，用户现有配置与凭据可用；不覆盖旧项目目录 | 待验收 |
| 四平台课程浏览 | 当前账号课程与资源信息匹配，空数据、失效连接及异常显示正确 | 待验收 |
| 课程工作台 | 返回、切换课程及平台、搜索条件、资源目录互不串用 | 待验收 |
| 设置与日志 | 焦点返回、取消和保存反馈、筛选、清空确认正确 | 待验收 |
| 缩放及主题 | 100%/125%/150% DPI，最小窗口及深浅主题可读，无异常横向溢出 | 待验收 |
| 托盘及退出 | 原窗口恢复、正常退出和本机进程清理正确 | 待验收 |

本轮冻结新增平台与功能开发。保留当前源码版本号，不通过重复版本标签发布不同二进制。最终发行仍需独立的发布门禁和真实用户交互验收；任何本地状态都不等于平台已确认的学习结果。
