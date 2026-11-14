# 学序 StudyFlow

**非商业用途的 Windows 学习助手**：将知到、长江雨课堂统一到独立设计的 React + Tauri 2 桌面界面，后端使用 Python 模块，通过本地 IPC 读取真实平台数据。

## 已有实现

- 自主编写的深色 / 浅色桌面 UI、课程卡片、平台状态、课程同步和章节视频列表。
- 知到：通过学序内置 ZHS 0.1.5 扫码与只读服务端诊断、课程同步，读取同会话 HMAC 绑定的缓存；原版 WPF 入口仅为可选备用。
- 雨课堂：读取课堂信息、章节和视频元数据。会话存储在 Windows Credential Manager。
- Tauri 2 Rust IPC 调用 PyInstaller 打包的 Python sidecar。
- Windows NSIS 安装包构建脚本，详见 [构建指南](docs/BUILD_WINDOWS.md)。

## 使用条件

- **无需预先安装原版知到助手**：学序安装包自带 ZHS Python 依赖；原版软件若存在仍独立保留，不会被修改或删除。
- 雨课堂需要本人有效的现有登录会话及课堂 ID；未登录或未连接时明确显示失败。
- 真实平台登录、课程读取和 Windows 安装包尚未经过用户环境的端到端验收，不能据此宣称全部已可用。

## 构建

在 Windows 上安装 Python 3.13、Node.js 22、Rust stable、VS C++ Build Tools、WebView2 后：

\`\`\`powershell
powershell -NoProfile -File .\scripts\build-windows.ps1
\`\`\`

或者通过 GitHub Actions 的 **Build Windows EXE** 工作流下载 NSIS 构建产物；与打包相关的主分支提交也会触发构建。构建完成必须再经用户 Windows 真机登录验收。

## 上游保留

- \`07xh/zhidao-assistant\` — 未更改的旧版 WPF/Python/Go 安装程序。
- \`07xh/yuketang-heartbeat\` — 未更改的旧版 Python 单体程序。
- LightC-UI 仅作为设计参考；本仓库 UI 独立实现，不包含其受限素材或源代码。

新程序不会模拟平台已完成的学习进度，不提供伪造学习记录的接口。

## 最新知到 UI 迁移

从 `zhidao-assistant@53c9244` 迁入学序统一 React 界面：课程动态卡片、核验证据标签、深色主题持久化、课程筛选及小窗口布局。保留原版 WPF 扫码入口；原版登录流程没有被覆盖。

对只读课程缓存继续进行 HMAC 会话绑定验证；原版知到、雨课堂账号和旧仓库全部保留。测试通过不等于真实 Windows 登录与平台学习进度已验证。详见 [知到 UI 迁移记录](docs/ZHIDAO_UI_MIGRATION.md)。

## 学序独立知到运行时

Windows 构建使用 `zhs==0.1.5` 固定依赖和 `scripts/build-sidecar.ps1` 进行 PyInstaller 独立编译，内置仅读取的课程 CLI 及登录工作进程。安装学序时不再要求已有 `%LOCALAPPDATA%\\ZHSDesktop\\.venv`。扫码状态/临时 PNG 独立写入 `%LOCALAPPDATA%\\StudyFlow\\zhidao`；知到账号与服务端核验缓存仍沿用本人 `%USERPROFILE%\\.zhs`，不会清除旧版登录。用户真实账号登录、课程读取仍须在 Windows 上核验，CI 无法替代。

## 原版模拟心跳代码恢复与进程接入

学序保留用户原始知到 ZHS 0.1.5 与雨课堂 `main.py` 的心跳生成和发送算法，不以只读查询替代它们。原始文件快照位于 `legacy/`，每个 Git blob SHA 与对应原仓库一致；前端由 Tauri 负责原版任务启动、状态和停止。学序优先调用内置 ZHS 0.1.5 CLI，雨课堂执行原封不动的 `main.py`。进程运行、退出不等于平台确认学习进度。见 [完整迁移记录](docs/ORIGINAL_HEARTBEAT_RESTORE.md)。

Windows 真实账号验收及雨课堂原源码许可核查仍是正式发布门槛。
