# 学序本地 IPC 契约 v1

Python 入口：`python -m studyflow.services.bridge`；标准输入 JSON Lines / 标准输出 JSON Lines。只读协议不输出 Cookie、原始 HTTP 响应或堆栈信息。

```json
{"id":"example-1","version":1,"operation":"platform.status"}
```

现有操作：
- `ping`：返回服务名及协议版本。
- `platform.status`：返回知到及雨课堂的服务端登录检测结果，不等同于 Cookie 文件存在。
- `courses.list`：按平台返回已读取的课程列表。只有真实知到旧版运行时与缓存核验成功时才返回课程；雨课堂暂未接入，返回 `PLATFORM_NOT_READY`。

课程字段 `platform`, `course_id`, `title`, `progress_percent`, `course_type`, `stale`, `progress_evidence`, `verified_at`。对于当前知到只读课程模块，`progress_percent=null`, `progress_evidence=null`, `verified_at=null`；页面不得伪造任何百分比。知到 `course_id` 是基于上游课程+教学班身份的不可逆哈希，不传共享课原始路由令牌。

错误码固定、经过净化。请求与响应 `id` 必须匹配，前端要拒绝缺少平台身份、跨平台记录和数据结构错误。

## 前端接线状态

`frontend/src/bridge.ts` 定义 `StudyFlowTransport` 并在可信宿主存在时读取 `window.studyflowTransport`。普通浏览器预览**没有这个对象**，也不会创建假 HTTP localhost 服务。

下一阶段需实现 Tauri 2 Windows 宿主：由受信任的 Rust 进程启动包内 Python sidecar，通过私有标准流转发上述操作。需要确保 API 白名单、每行长度限制、请求/响应关联、进程退出清理、错误脱敏和平台会话隔离。

目前还没有 Tauri 生产构建、官方 Windows EXE、真实知到扫码/浏览器登录接口及播放 IPC，不能称为已具备完整功能。
