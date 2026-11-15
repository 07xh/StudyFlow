# 知到并发实现与验收记录

对应计划：`2026-11-15-zhidao-concurrency.md`。

- 设置、资源目录、进程监督与 IPC/UI 已实现；合入主分支截至 `e151200` 的设置/进度界面改动，无冲突。
- 独立审查完成：两项审查问题均经失败回归复现后修复。共享课验证码/时间限制不能被上游转成正常退出后补位；已退出视频的数值清除，避免旧采样被队列新时间戳续期。
- 补充真实子进程入口检查发现父管道监听线程的 BufferedReader 锁导致正常退出崩溃；改用底层 `os.read`，正常退出和父死子停均通过子进程回归。独立源代码 worker 在隔离空会话下返回预期代码 4，无崩溃。
- Python 3.13：`python -m pytest -q`，291 passed。
- React：`npm test --prefix frontend`，170 passed。
- TypeScript/Vite：`npm run build --prefix frontend`，成功。
- ZHS 0.1.5 私有构建副本：`python -m studyflow.services.zhs_upstream_patch prepare build/zhs-stage`，哈希及补丁检查成功。
- Windows 原生编译、安装包测试以 PR CI 的实际结果为准；当前机器没有 Cargo/Windows。直接 Chromium 视觉截图被运行环境的进程 socket 权限阻断，未声称截图验收成功。
- 真实账号并发记账、真实网络下会话切换时序未验收；不将离线测试、原生构建或进程结束视为平台已完成。

实现裁定：保持原有发送实现，单视频子进程强制上抛普通错误，由课程监督进程决定是否继续；这是为了避免上游循环吞掉某个视频失败。旧存量设置迁移为单路，避免升级静默改变执行方式；用户可在课程设置中明确切换到双路。
