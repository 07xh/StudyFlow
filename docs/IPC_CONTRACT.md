# StudyFlow 本地 IPC 契约 v1（Tauri 2 + Python）

Rust 桌面壳使用固定路径启动随 Windows 安装程序打包的 `bin/studyflow-bridge.exe`。输入输出都是每行一个 JSON；一般读取使用独立进程，扫码及运行控制等需要共享内存状态的操作使用受管理的常驻 sidecar。无对外 HTTP 监听端口。

示例请求：
\`\`\`json
{"id":"test-1","version":1,"operation":"platform.status"}
\`\`\`

## 已连接的操作

| 操作 | 输入 | 返回 |
| --- | --- | --- |
| \`ping\` | 无 | sidecar 版本 |
| \`platform.status\` | 无 | 知到 / 雨课堂 / 学习通 / U校园连接状态 |
| \`courses.list\` | \`platform\` | 真实课程记录 |
| \`videos.list\` | \`platform:"yuketang"\` | 当前课堂的真实章节视频 |
| \`yuketang.configure\` | \`configuration\` | 保存会话到 Windows 凭据管理器 |
| \`yuketang.clear\` | 无 | 仅清除学序保存的会话 |

知到扫码通过 `zhidao.qr.start/status/cancel` 调用内置 sidecar；只读检测及课程读取使用打包的知到模块。旧版 `launch_zhidao_legacy` 命令及前端包装函数因无有效调用已移除，不再依赖外部 WPF 客户端进行扫码。

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
- `progress_evidence`、`verified_at` 根据实际读取结果提供。前端需要二者同时提供有效的服务器核验证据才展示进度百分比；历史缓存和未核验记录不产生当前完成率。
- `stale=true` 始终显示「历史缓存待核验」，不使用过时进度作为当前完成率。
- React UI 通过 Tauri `bridge_request` 发送 JSONL IPC，核对 `id` 和平台身份，拒绝跨平台记录及异常格式；保留雨课堂现有配置、清理和视频请求。
