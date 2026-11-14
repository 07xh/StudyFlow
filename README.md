# 学序 StudyFlow

**非商业用途的 Windows 学习助手**：将知到、长江雨课堂统一到独立设计的 React + Tauri 2 桌面界面，后端使用 Python 模块，通过本地 IPC 读取真实平台数据。

## 已有实现

- 自主编写的深色 / 浅色桌面 UI、课程卡片、平台状态、课程同步和章节视频列表。
- 知到：调用原有 Windows ZHSDesktop 的服务端登录检查与课程同步，读取同会话绑定的缓存。
- 雨课堂：读取课堂信息、章节和视频元数据。会话存储在 Windows Credential Manager。
- Tauri 2 Rust IPC 调用 PyInstaller 打包的 Python sidecar。
- Windows NSIS 安装包构建脚本，详见 [构建指南](docs/BUILD_WINDOWS.md)。

## 使用条件

- 知到原版程序需已安装且通过自身扫码登录；**学序不会修改或删除原版程序**。
- 雨课堂需要本人有效的现有登录会话及课堂 ID；未登录或未连接时明确显示失败。
- 真实平台登录、课程读取和 Windows 安装包尚未经过用户环境的端到端验收，不能据此宣称全部已可用。

## 构建

在 Windows 上安装 Python 3.11、Node.js 22、Rust stable、VS C++ Build Tools、WebView2 后：

\`\`\`powershell
powershell -NoProfile -File .\scripts\build-windows.ps1
\`\`\`

或者在 GitHub Actions 手动运行 **Build Windows EXE (manual)**，成功后下载 NSIS 构建产物。为了节省 Actions 时间，默认不会每次提交自动打包。

## 上游保留

- \`07xh/zhidao-assistant\` — 未更改的旧版 WPF/Python/Go 安装程序。
- \`07xh/yuketang-heartbeat\` — 未更改的旧版 Python 单体程序。
- LightC-UI 仅作为设计参考；本仓库 UI 独立实现，不包含其受限素材或源代码。

新程序不会模拟平台已完成的学习进度，不提供伪造学习记录的接口。

## 最新知到 UI 迁移

从 `zhidao-assistant@53c9244` 迁入学序统一 React 界面：课程动态卡片、核验证据标签、深色主题持久化、课程筛选及小窗口布局。保留原版 WPF 扫码入口；原版登录流程没有被覆盖。

对只读课程缓存继续进行 HMAC 会话绑定验证；原版知到、雨课堂账号和旧仓库全部保留。测试通过不等于真实 Windows 登录与平台学习进度已验证。详见 [知到 UI 迁移记录](docs/ZHIDAO_UI_MIGRATION.md)。

## 原版模拟心跳代码保留与接入

知到 ZHS 0.1.5、雨课堂原始 `main.py` 的心跳发送算法保持不变。本仓库的原版源码快照位于 `legacy/{zhidao,yuketang}`，通过单独子进程调用，不覆盖原版软件。学序 UI 可以启动、查询、停止自身创建的原版任务；进程退出不等于服务器学习进度确认。详见 [原版心跳迁移记录](docs/ORIGINAL_HEARTBEAT_RESTORE.md)。**真实 Windows 与平台验收及第三方许可审查尚未完成。**
