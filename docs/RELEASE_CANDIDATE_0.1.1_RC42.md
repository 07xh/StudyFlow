# 学序 StudyFlow 0.1.1-rc.42｜U校园真实课程 ID 被 IPC 拒绝

## 用户 Windows 截图
进入 U校园“实验性虚构事件模块”，课程、单元已经显示，点击开始后界面提示“桌面端拒绝了此操作（IPC 白名单或参数不匹配），并非 Python sidecar 缺失”，状态停留“尚未读取”。

## 根因
真实 U校园课程 `instanceId` 可能形如 `course-v2:75b7546ea002b72+nhce_v4_rw_2+20230116`。
只读 `ucampus.units.list`/进度验证的 Rust 与 Python 标识规则接受 `+`，但运行状态、历史与运行控制的 Tauri IPC 校验及 Python 运行目标校验只接受字母、数字、下划线、连字符、冒号。导致部分请求在 Rust 边界直接出现 `Operation not permitted`，甚至无法进入 Python；状态和开始操作都可能被拒绝。

## 修复
- Tauri `ucampus.heartbeat.*` 和 `ucampus.fabricated.*` 的课程 ID 与单元 ID 校验统一支持字面量 `+`。维持原长度上限，仍禁止斜线、问号、百分号、井号、换行等，避免路径注入、错误作用域。
- Python 对应 `fabricated_heartbeat._ID_RE` 与既有 `course_progress._ID` 一致，运行目标、状态和历史不会因 `+` 被误拒绝。
- Rust 测试覆盖实际 `course-v2` ID 的状态/历史/启动/暂停/恢复/停止操作，及截图中的 `pulses=6`、时长 600 秒、间隔 20 秒；Python 测试覆盖相同 ID 与拒绝异常路径标识。
- 不改变任何平台的登录认证、接口地址、签名或发送语义，不扩大到任意课程标识；遵守现有服务端反馈，不以本机运行计数作为服务器确认。

## 验收
通过 Python、React/IPC、Rust/NSIS Windows 打包和安装升级检查后发布。CI 只证明这类合法请求可以穿过静态校验与安装可用，不保证内容权限、通信或服务器确认。本地状态与官方服务器学习记录始终分开。
