# 学序学习通：第三方执行器对接约定

适用：StudyFlow 学习通独立适配器。此文档定义稳定扩展边界，不包含学习进度心跳生成或发送实现。

## 现有模块

- adapter.py：从学习通真实接口读取课程、章节、任务点信息。
- credentials.py：Windows 凭据管理器存放用户本人的登录会话。
- settings.py：保存速度、章节并发、跳过完成项和核验选项。
- runner_port.py：独立任务运行器的接口定义。
- services/bridge.py：有校验的 JSONL 通信。
- frontend/src/components/XuexitongPanels.tsx：复用统一账号、课程详情和参数设置页面。

## 对接约定

1. 用户自行维护的独立运行器保留在 Python Sidecar 内，通过 runner_port.py 的 XuexitongTaskRunner 协议与学序交互。
2. 运行器从 settings.read() 获取参数，从 credentials.load() 获取登录会话；不向 UI 返回 Cookie、媒体访问令牌或原始请求数据。
3. start 返回唯一 run_id，status/pause/resume/stop 根据当前 run_id 校验身份，避免控制到已替换的任务。
4. 返回 RunSnapshot 中的纯运行状态；共享 UI 只展示任务生命周期，服务器进度另行查询并标明数据来源。
5. 不修改知到和雨课堂原版执行器，不创建独立的窗口或第二套平台导航。
6. 当前尚未注册运行器，不在学习通 UI 展示虚假的运行按钮或伪装完整功能。
7. 合并前必须通过 Python、React、Rust、Windows NSIS 和实际账号读取验证。

## 参数契约 v1

- playback_speed: number, 0.25..2.0，默认 1.0
- concurrency: integer, 1..4，默认 2
- skip_completed: boolean，默认 true
- verify_after_run: boolean，默认 true

这些参数在当前版本仅保存供后续运行器使用，不会自动触发任务。

## 状态

第三平台账号、课程、章节及任务元数据和统一 UI 为已开发范围；执行器由使用者自行接入，未验收前不标记为完整功能。
