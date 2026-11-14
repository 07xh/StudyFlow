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

## 知到二维码登录核心迁移

来源：`07xh/zhidao-assistant` 的 `payload/ZHS-QRLogin.py`，固定版本 `31831684dd63191676c13e1d9a33df81ed78378b`。原仓库保持不变。

- `platforms/zhidao/qr_login_core.py`：保留 ZHS 0.1.5 原版扫码轮询、CAS 认证核验、Cookie 原子保存、扫码后立即删除 PNG 和退出清理。
- `platforms/zhidao/qr_runtime.py`：仅启动本机已有知到运行时中的 Python，提供 `start/status/cancel`，短期二维码 PNG 只在本次登录、尚未扫码阶段通过 `image_png_base64` 交给本地 UI。不要记录或持久化该字段。
- `services/bridge.py`：新增 `zhidao.qr.start`、`zhidao.qr.status`、`zhidao.qr.cancel` IPC；失败只返回固定脱敏错误码。
- `src-tauri/src/lib.rs`：二维码三种请求使用专用常驻 Python bridge，确保跨 UI 调用共享同一登录任务；课程读取等原有请求继续使用现有单次子进程模式。
- `frontend/src/bridge.ts`：新增二维码状态和命令的类型化接口。React 页面尚未接入扫码按钮和二维码窗口。

当前仍依赖旧知到安装目录中的 ZHS Python 环境；学序安装器未独立打包这套依赖。CI 只覆盖离线逻辑和构建，Windows 真机扫码认证、刷新、取消和退出清理仍需验收。
