# StudyFlow 本地 IPC 契约 v1

当前 Python 服务端：`python -m studyflow.services.bridge`，标准输入每行一个 JSON 请求，标准输出每行一个 JSON 响应。

请求示例：
```json
{"id":"test-1","version":1,"operation":"platform.status"}
```

可用只读操作：
- `ping`：服务版本。
- `platform.status`：知到与雨课堂的连接状态（当前均未接通）。
- `courses.list`：按平台读取课程。尚未接线时返回 `PLATFORM_NOT_READY`，绝不伪造课程。

错误只返回固定错误码，避免泄露 Cookie、请求 URL 或异常详情。

## Windows Tauri 集成尚待完成

浏览器 UI 不直接启动 Python，也不通过未认证的 localhost 端口通信。
后续 Tauri 后端应负责启动打包后的 Python sidecar，通过私有标准输入输出管道转发上述协议，并限制命令白名单、进程生命周期和消息大小。

## 上游业务接入门禁

知到 `zhidao_only.py` 提供课程读取入口，但需要独立登录态、缓存路径和依赖审查。
雨课堂 `main.py` 含只读章节查询，也含模拟观看、进度心跳发送；当前仅计划迁移课程元数据读取，排除进度伪报。
