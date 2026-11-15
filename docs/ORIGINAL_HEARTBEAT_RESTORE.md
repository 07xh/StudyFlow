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
- 知到：`学序 Tauri UI → Rust legacy_start(zhidao, course hash) → Python 确认当前账号的课程 HMAC 指纹并找到原始智慧课程 ID → %LOCALAPPDATA%/ZHSDesktop/Zhidao-Task.cmd play-ai ... → 原 ZHS 0.1.5`。**优先使用学序内打包的 ZHS 0.1.5 原版 Typer CLI；缺失时回退到原版 ZHSDesktop 安装环境**。不会重写 ZHS Python 库的心跳机制。
- 停止：由 Rust 管理**学序启动的**子进程树；不会触碰用户在其他窗口单独运行的原版程序。关闭学序主窗口时，托管子进程清理。强制退出任务后需重新核验服务器记录。
- 状态：只说明托管进程启动、运行、退出和退出码。**不能由退出码推断远端心跳被接受或完成课程。** 服务端进度仍使用已有平台只读接口查询。

## 原版配置与菜单接入

雨课堂 `main.py` 实际读取的 12 个非凭据参数，现已全部映射到学序雨课堂专属参数页：

- 视频：`VIDEO_SPEED`、`HEARTBEAT_INTERVAL`、`MAX_CONCURRENT_VIDEOS`
- 本地统计与批量选项：`COMPLETION_THRESHOLD`、`SKIP_COMPLETED`、`USE_CONCURRENT`、`TEST_MODE`、`TEST_VIDEO_COUNT`
- 图文与诊断：`AUTO_RICHTEXT`、`RICHTEXT_STAY_SECONDS`、`RICHTEXT_SKIP_DELAY`、`DEBUG`

UI 通过原 `exe_entry.py` 的 `read_cfg/save_cfg` 读写本机 `.env` 格式；启动时再由 Tauri Rust 对同一组已校验值设置子进程环境变量。凭据 `CLASSROOM_ID`、`SIGN`、`UNIVERSITY_ID`、`CSRF_TOKEN`、`SESSION_ID` 仍由学序凭据存储提供，不作为普通参数暴露。图文和 DEBUG 参数默认折叠；DEBUG 日志可能包含课程/视频标识。

StudyFlow UI 已承接可确认的菜单操作：读取/保存参数、启动任务、查询状态、停止任务。**原 EXE 的完整字节码尚未恢复**，因此无法证明旧二进制中是否存在 `exe_entry.py` 以外的隐藏菜单或行为；不得把这一部分标为已恢复。原 `main.py` 和 `exe_entry.py` 保持原字节内容，源文件哈希由 `tests/test_original_playback.py` 保护。

## 发布与验证边界

- Python + Node 契约测试仅验证代码路径、参数和源码一致性；CI 通过不能替代真实 Windows 进程执行、ZHS 安装完整性及平台服务器确认。
- `yuketang-heartbeat/README.md` 明确指出其原始源码的权利/第三方材料归属尚未核清，且原仓库**未授予通用开源许可**。即使用户个人非商业使用获授权，公开发布复制件和打包 EXE 仍需对权利及许可核对。
- 不把 LightC Source Available 限制代码复制进学序。
- 在 Windows 进行原用户账号和官方平台端到端验收前，不发布“已完整可用”的结论。

独立打包底座来自学序的 `scripts/build-sidecar.ps1`：原有 QR、只读课程入口与 zhs==0.1.5 保留，新增原雨课堂 `main.py` 资源和 `python-dotenv`。Windows 打包构建必须实际验证该入口。

## 学序内接入 ZHS 原版实时模拟片段（只读）

- 本轮将原知到 `payload/ZHS-ConsoleMonitor.py` **原字节内容**保存为 `legacy/zhidao/ZHS-ConsoleMonitor.py`，测试锁定源 Git blob `fbff5bce350245ddf4dfde42ea8a18db944ff307`。
- 仅在启动已打包的 ZHS 0.1.5 CLI 时附加原版 `StdoutObserver`，观察 `playing [..] 48.5%` 与「处理资源 i/n」。保留原 CLI 参数、算法与发送实现；原环境回退入口仍按旧逻辑运行，但无法保证输出实时片段。
- 每次 Windows 任务使用独立随机 128 位令牌。监控只写 `%LOCALAPPDATA%/StudyFlow/monitor-zhs-<token>.json`，不存储 Cookie、课程名称、请求内容或控制台全文。
- Tauri 仅读取大小不超过 2048 字节、令牌相符、时间戳处于前 10 秒至过去 18 秒范围的数值。退出、停止和关闭程序都会清理当前令牌对应文件。
- 页面把本地模拟片段放在知到任务状态卡中，约 2 秒刷新，只有当前选中课程与正在运行的任务一致才显示。服务器课程进度保持单独视图。
- 离线测试覆盖源码一致性、解析与资源切换、原 CLI 参数不变、进程退出清理以及前端身份匹配。**真实 Windows sidecar / ZHS 输出编码 / 官方服务器更新仍须实机核验**。

## 后续变更（2026-11-15）

本页记录原版功能恢复时的状态。新补丁在构建阶段生成隔离 ZHS 0.1.5 副本，以修复本地进度确认与异常退出问题；打包副本不再是原版发送源码的逐字节复制。原始备份、入口与心跳协议不变。详见 docs/ZHS_UPSTREAM_SENDER_RELIABILITY.md。
