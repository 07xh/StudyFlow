# 原版模拟心跳保留与学序接入（2026-11-14）

## 用户要求和修复

- 禁止将原知到 / 雨课堂**模拟心跳发送**实现擅自改写为官方播放器或只读进度接口。
- 原仓库保持不变，旧安装程序及现有登录、课程、视频与雨课堂配置均保留。
- 上轮未合并的替代分支已使用 force-with-lease 恢复到当时主分支基线。
- 本分支只新建 **原版源码快照 + 本机启动/停止/状态管理**。所有源码快照都由 Git SHA 测试保护。

## 来源与可验证性

知到源：`07xh/zhidao-assistant@53c92446d40b2cd1732c9aa1884d9f3b3a3fe55a`

- `legacy/zhidao/Zhidao-Task.cmd`：原来的 ZHS 0.1.5 `play-ai` 命令启动器
- `legacy/zhidao/HeartbeatMonitor.ps1`：监测任务 / HTML5 / 服务端数据的隔离状态
- `legacy/zhidao/HeartbeatView.ps1`：原 WPF 状态面板
- `legacy/zhidao/ZHS-ConsoleMonitor.py`：原版 CLI 可观察信息
- `legacy/zhidao/Official-Player.ps1` 与 `Official-MediaController.js`：原官方 WebView2 界面

雨课堂源：`07xh/yuketang-heartbeat@a81cf336d7f2d635d7500b5d6698e251e88c5a73`

- `legacy/yuketang/main.py`：原来的完整菜单外业务逻辑：`YuketangHeartbeat`、心跳数据生成/发送、单/多视频、图文等（**未修改任何一行**）
- `legacy/yuketang/exe_entry.py`：原菜单入口与配置
- `legacy/yuketang/requirements.txt`：原始依赖

每个副本的 Git blob SHA 与原仓库一致；`tests/test_original_playback.py` 是持续门禁。

## 运行路径

- 雨课堂：`学序 Tauri UI → Rust legacy_start(yuketang) → 打包的 studyflow-bridge.exe --legacy-yuketang → runpy.run_path(原 main.py, "__main__")`。账号会话从学序已有 Windows Credential Manager 取得，原 `main.py` 的环境变量参数沿用其原来名称和默认值。日志由原代码按原逻辑写入本机 StudyFlow 用户目录，不输出至 WebView。
- 知到：`学序 Tauri UI → Rust legacy_start(zhidao, course hash) → Python 确认当前账号的课程 HMAC 指纹并找到原始智慧课程 ID → %LOCALAPPDATA%/ZHSDesktop/Zhidao-Task.cmd play-ai ... → 原 ZHS 0.1.5`。**仍依赖原版 ZHSDesktop 安装及其 Python 虚拟环境**。不会重写 ZHS Python 库的心跳机制。
- 停止：由 Rust 管理**学序启动的**子进程树；不会触碰用户在其他窗口单独运行的原版程序。关闭学序主窗口时，托管子进程清理。强制退出任务后需重新核验服务器记录。
- 状态：只说明托管进程启动、运行、退出和退出码。**不能由退出码推断远端心跳被接受或完成课程。** 服务端进度仍使用已有平台只读接口查询。

## 保留的参数

雨课堂原版：`VIDEO_SPEED`、`HEARTBEAT_INTERVAL`、`MAX_CONCURRENT_VIDEOS`、`COMPLETION_THRESHOLD`、`SKIP_COMPLETED`、`USE_CONCURRENT`、`TEST_MODE`、`TEST_VIDEO_COUNT`、`AUTO_RICHTEXT`。UI 只把这些原参数作为环境变量传递，不改变原程序算法。当前并未迁入原版完整交互式终端菜单操作，已保留对应源文件。

## 发布与验证边界

- Python + Node 契约测试仅验证代码路径、参数和源码一致性；CI 通过不能替代真实 Windows 进程执行、ZHS 安装完整性及平台服务器确认。
- `yuketang-heartbeat/README.md` 明确指出其原始源码的权利/第三方材料归属尚未核清，且原仓库**未授予通用开源许可**。即使用户个人非商业使用获授权，公开发布复制件和打包 EXE 仍需对权利及许可核对。
- 不把 LightC Source Available 限制代码复制进学序。
- 在 Windows 进行原用户账号和官方平台端到端验收前，不发布“已完整可用”的结论。
