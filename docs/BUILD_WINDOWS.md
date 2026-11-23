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

脚本依次安装依赖、运行 Python 测试、构建 React、使用 PyInstaller 编译 sidecar、生成本项目原创图标，再使用 Tauri 2 打包 NSIS 安装程序。

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

知到官方播放器参数保存到 `%LOCALAPPDATA%/StudyFlow/zhidao/official-player-settings.json`。初次读取可兼容旧 ZHSDesktop 设置，保存时不会写回旧安装目录。

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
