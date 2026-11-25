# StudyFlow 本地 IPC 契约 v1（Tauri 2 + Python）

Rust 桌面壳使用固定路径启动随 Windows 安装程序打包的 \`bin/studyflow-bridge.exe\`。输入输出都是每行一个 JSON；每个请求使用独立进程，互不共享敏感状态。无对外 HTTP 监听端口。

示例请求：
\`\`\`json
{"id":"test-1","version":1,"operation":"platform.status"}
\`\`\`

## 已连接的操作

| 操作 | 输入 | 返回 |
| --- | --- | --- |
| \`ping\` | 无 | sidecar 版本 |
| \`platform.status\` | 无 | 知到 / 雨课堂服务端状态 |
| \`courses.list\` | \`platform\` | 真实课程记录 |
| \`videos.list\` | \`platform:"yuketang"\` | 当前课堂的真实章节视频 |
| \`yuketang.configure\` | \`configuration\` | 保存会话到 Windows 凭据管理器 |
| \`yuketang.clear\` | 无 | 仅清除学序保存的会话 |

知到扫码由前端经 `bridge_request` 调用内置 Python sidecar 的 `zhidao.qr.start`、`zhidao.qr.status`、`zhidao.qr.cancel`，无需启动旧版 WPF。保留只读课程查询与连接诊断，不更改旧版本。

## 约束

- Rust 限制操作白名单、输入大小和 sidecar 路径；UI 不能执行任意 shell 命令。
- 响应仅提供公开错误码，不输出原始异常、Session ID、Cookie 或网络 URL。
- \`yuketang.configure\` 仅接受当前用户主动输入的会话配置；存储在 Windows Credential Manager。
- Python 子进程的 stdout 只用于 JSON 协议，不允许业务日志混入。
- 课程进度只有真实平台返回才可展示；未知为 \`null\`。
- 运行时路径、身份、有效会话和 Windows 安装包仍需端到端测试。不存在假登录或假课程。

## 源码兼容

旧知到 WPF UI、旧雨课堂单体 \`main.py\` 保留在原仓库，并可继续独立使用；学序新增适配层，不覆盖旧文件。

## 知到 UI 课程证据字段（后向兼容）

`courses.list` 保留原有 `platform`、`course_id`、`title`、`progress_percent`，新增 `course_type`、`stale`、`progress_evidence`、`verified_at`。

- 对已接线的知到只读缓存，`course_id` 采用稳定不可逆的教学班身份哈希；`course_type` 为 `ai` 或 `shared`。
- `progress_evidence`、`verified_at` 目前返回 `null`。前端需要二者同时提供有效的服务器核验证据才展示进度百分比。
- `stale=true` 始终显示「历史缓存待核验」，不使用过时进度作为当前完成率。
- React UI 通过 Tauri `bridge_request` 发送 JSONL IPC，核对 `id` 和平台身份，拒绝跨平台记录及异常格式；保留雨课堂现有配置、清理和视频请求。

## 历史播放器退役边界

`launch_zhidao_legacy`、`zhidao_player_prepare`、`zhidao_player_start` 已移出原生命令注册；Python 不再提供 `zhidao.player.target`、`zhidao.player.settings.get` 或 `zhidao.player.settings.save`。仅保留历史任务停止、状态查询及明确的本机 WebView 配置清理接口；原始文件及许可证留档。
