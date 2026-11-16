# U校园 / U校园5.0（AI版）接入说明

当前阶段：**实验性只读接入，真实接口尚未完成账号验收，不得发布为已可用**。

- 用户确认当前使用 U校园5.0（AI版）。
- 已观察到「学习」页面含「校内课程」「自学教程」「作业」「课堂互动」入口。
- 截图显示课程体系/教材、课程名称与记分周期是不同字段。截图仅作为信息架构参考，不将个人课程信息写入仓库、示例课程或默认数据。
- 旧版 / AI 版的课程接口和会话独立处理。当前优先 AI 版。
- 已预留平台注册、凭据配置、只读 JSON 课程列表和单独页面。**不假设**移动端接口、参数、字段或课程进度已验证。
- 登录会话使用 Windows Credential Manager；UI 仅返回配置状态，不回显 Cookie、Authorization。网络请求只允许明确配置的 Unipus HTTPS 主机、禁止重定向，限时限量，只读取课程，不发送学习行为。

## 下一步真实验收

1. 从用户本人已登录的 U校园5.0 课程列表网络请求中获取打码的 HAR（不要将登录口令、Cookie、Authorization 或学号提交到仓库）。
2. 验证实际请求方法（GET/POST）、域名、参数、返回结构、分页/课程分类与会话过期特征。当前试验适配器**仅支持 GET JSON**，若真实接口不是该形式必须修改适配器，不能套用假接口。
3. 增加经过脱敏的 fixture 和契约测试，再接入真实会话并读取课程、单元/章节、作业与服务器进度；不使用伪造完成率。
4. 通过 Python、前端、CI、Windows 打包门禁后再发布安装包。

## 成熟源码优先复用（2026-11-16）

已核对的上游提交与复用边界：

| 来源 | 上游 SHA（可复现） | 许可证 | 学序复用范围 |
|---|---|---|---|
| [Zzj-klwgxdz/UnipusAI](https://github.com/Zzj-klwgxdz/UnipusAI/tree/937725ede225f63e7746f11c0ff6ac297e524909) | `937725e` | GPL-3.0 | **已参考实现**首页/书架读取及只读目录解析 |
| [YSJohnson/UnipusAI-Helper](https://github.com/YSJohnson/UnipusAI-Helper/tree/fffb882adf5d1d35c259bc5b653273f0eac094c9) | `fffb882` | AGPL-3.0 | **待适配**章节目录、必修/完成等状态模型 |
| [ACaiCat/UnipusHelper.NET](https://github.com/ACaiCat/UnipusHelper.NET/tree/3e8492fab6aa0bbaa72aecf60fead39a7248ac21) | `3e8492f` | MIT | **架构参考** API 定义及数据模型 |

本仓库自身为 GPL-3.0；复制文件、修改、分发前保留对应版权和许可证条款。
不同运行时不能将类名相似视为协议兼容；正式运行时必须基于 U校园5.0
实际网络数据核验接口及字段，尤其不能套用学习通或知到的心跳包格式。


学序仓库为 GPL-3.0。U校园AI版首页课程列表、我的教材两级目录解析
参考了 GPL-3.0 [Zzj-klwgxdz/UnipusAI](https://github.com/Zzj-klwgxdz/UnipusAI)
的 `src/api/course.rs`。本仓库的 Python 实现只提取可靠的只读字段
`value.courseList[].courseResourceList[].instanceId/name` 以及书架 `value.groups`。
首页读到空列表才走已知书架接口；不复用自动答题、提交或虚报进度代码。

- AI版默认首页课程 API 已有可审核的开源来源，无须猜测或手动粘贴 URL。
- 使用者仍须在本机提供有效且由本人持有的会话。是否适用于该账号必须经 Windows 真机验证。
- 章节、资源、学习活动、发送协议及服务端进度尚未接入，**不得视为已交付心跳能力**。
- 章节任务状态研究优先参考 `YSJohnson/UnipusAI-Helper`；通用 UI 与任务调度优先复用学序内部实现。
- 账号、会话、接口错误不上传日志或仓库；无需在聊天里共享 Cookie。

## 单元和任务只读读取（基于上游 937725e）

- `ucampus.units.list`：按上游 `course_progress/{course}/{openId}/default` 读取 `rt.units` 键集合；仅标记“单元状态待核验”，不以单元存在推断完成。
- `ucampus.unit.tasks`：按上游单元级 `course_progress/{course}/{unit}/{openId}/default/` 读取 `rt.leafs`；复用 `tab_type`、`strategies.required`、`state.pass` 语义。任务标题缺失时仅显示资源 ID。
- `openId` 仅在本机从会话 JWT 的 `openId` 声明提取，不能当作已认证凭据；会话缺失则返回 `UCAMPUS_OPEN_ID_REQUIRED`，不从别的账号猜测。
- 真实接口需 U校园AI 登录会话和服务端认可的请求头。当前不预制完整播放器会话，也不直接生成心跳；未确认的服务器进度留空。

## 可选内容接口会话头

`Zzj-klwgxdz/UnipusAI` 的 `src/api/session.rs` 对 U校园AI 内容接口使用
`u-openid`、`x-csrftoken`，以及在有值时使用的
`x-annotator-auth-token`、`u-school`。本次只引入**用户持有的可选值**，
在 Windows Credential Manager 中与当前会话一起保存；前端不持久化或回显这些字段。
只向固定的 `https://ucontent.unipus.cn` 只读进度接口发出，不跟随重定向；
未配置时不签发、推断或伪造额外授权标识。

这些头是上游实现参考，学序仍未使用本人的真实账号验证成功，
不意味着 U校园已支持本地心跳发送或学习完成状态写入。

## 学序本地自定义心跳生成与桌面启动入口

用户明确指定：U校园以 **学序本机产生自定义心跳事件** 为基础，
不依赖官方播放器或其心跳线程，也不从视频播放位置产生本地心跳。
`src/studyflow/platforms/ucampus/local_runtime.py` 由本机单调时钟生成
`LocalPulse`，其中 `local_elapsed_seconds` **仅表示本地引擎运行时间**，
不是平台观看时长，不包含已完成/得分声明。

`src/studyflow/services/ucampus_runtime_bridge.py` 是长驻 JSONL sidecar 中的
本地任务服务。桌面端 `ucampus.heartbeat.start/status/pause/resume/stop`
操作通过 Tauri IPC 进入同一长驻进程；启动前要从
`UCampusProgressReader.list_tasks` 读取当前真实课程的真实单元资源 ID。
章节内资源顺序执行，底层支持按章节分组的受控并发；
UI 当前只允许选一个单元，不对用户展示伪造课程、资源或进度。

**当前生产发送尚未上线**：`PulseTransport` 只是明确的适配器接口，
`ucampus_runtime_bridge` 仍以 `transport=None` 启动，
所以能够实际生成本地事件，但不会向 U校园发请求：
`generated` 可增长，`sent` 必须为 0，
`server_confirmed` 必须为 null。
U校园心跳请求格式与服务端规则需使用本人课程的脱敏样本核对，
后续才可开发协议适配器，并独立核验发送及服务器结果。
不要将本地事件数展示成课程完成率或平台学习时长。

本地任务运行不等于 U校园学习功能已通过账号验收；
PR 维持 Draft，直到生产请求与测试完成。

## U校园AI `course-v2:` 路径标识兼容修复

上游 UnipusAI 的课程接口文档明确出现 `course-v2:...` 课程 ID。
原有 Python 和 Tauri IPC 校验禁止冒号，会导致真实课程能读取但
单元、资源与本地运行入口无法使用。现在允许路径段中安全的 `:`，
保留禁止 `/`、`%`、`?` 和其他非预期字符；相关跨层回归测试覆盖此场景。

兼容修复不是平台发送协议已接入或课程学习已完成的证明。

## 独立 HTTP 活动发送层与脱敏协议诊断（2026-11-16）

`src/studyflow/platforms/ucampus/send_transport.py` 已提供 `UCampusHTTPTransport`
和 `VerifiedSendContract`：限定第一方 HTTPS 域名及路径、严格请求参数范围、
不跟随重定向、HTTP 超时保守处理、服务端回执三态
（`accepted`、`rejected`、`unknown`），以及独立的 `server_completed=null`。
该代码**是真实可用的 HTTP 发送基础组件**，但 `VerifiedSendContract` 还没有
通过 U校园本人账号的真实请求样本验证，尚未注册生产协议或连接当前本地调度器；
不会假设“HTTP 200 = 心跳认可 = 课程完成”。
发送时要求真实学习活动数据，与本地计时独立。

目前已核对的开源项目 `Zzj-klwgxdz/UnipusAI` 中
`src/api/submit.rs` 是题目/任务提交、标记已看接口，不足以证明
视频/音频心跳协议的请求方法和服务端验收含义。

用户可以**只在本机**使用如下命令，对本人有权访问的网络 HAR 生成不含
账号、查询参数、Cookie、Authorization、请求体值、响应体值的结构摘要：

```powershell
python -m studyflow.platforms.ucampus.har_diagnostics .\own-session.har > ucampus-structure.json
```

输出只包含官方域名、请求方法、泛化路由、HTTP 状态和允许的 JSON 字段名。
不要公开原始 HAR、Cookie 或登录会话。结构摘要用于确定真实协议，
不是自动绕过平台认证的工具，也不能直接作为可以提交进度的证明。

## 旧版 Socket.IO WebSocket 传输层（2026-11-16）

已核验 [z5882852/unipus-tool](https://github.com/z5882852/unipus-tool/blob/main/ws.py)
存在本地建立 WebSocket、加入命名空间和发送消息的旧版实现。
当前上游项目已归档，未发现明确源码授权许可证；**不直接复制其代码**。
StudyFlow 的 `socketio_client.py` 为独立实现，提供：

- TLS 证书验证默认开启（旧源码直接关闭验证，不可复用）；
- 固定 U校园官方 WSS 域名、已编码的连接凭据、Engine.IO v3 握手与 ping/pong；
- 命名空间加入、发送事件、应答分类、超时断开与关闭资源；
- 运行进度与传输应答独立，不从任意应答判断课程完成。

**该模块不需要播放器提供心跳；学序本地心跳由 `local_runtime.py` 生成。**
它只是旧版传输基础组件；U校园AI 5.0 是否仍接受旧版 Socket.IO、
具体课程事件名称/字段、服务端学习记录判定均未通过本人账号验收。
因此不在生产版本自动发送旧版的伪造学习时长消息。

## 旧版 WSS 握手诊断（Windows IPC）

新增桌面操作 `ucampus.socket.diagnose`：由本人点击按钮后才发起
**一次**旧版 Socket.IO v3 握手及命名空间加入，结束立即关闭连接；
不会发出任何媒体学习事件，也不会启动/中断当前本地心跳调度。

- 使用保存在 Windows 凭据管理器的本人 U校园AI会话，不通过 UI 回显凭据。
- 无会话或无 `annotator_token` 时直接返回明确错误码，不发起网络连接。
- 只返回 `handshake=namespace_joined`、`learning_events_sent=0`、
  `progress_verified=false` 和 `ai5_compatible=null`，不输出凭据、原始请求、服务器消息。
- 握手成功只证明旧版传输/认证当时成功，**无法证明 U校园AI5.0 允许旧版心跳消息或认可学习时长**。
