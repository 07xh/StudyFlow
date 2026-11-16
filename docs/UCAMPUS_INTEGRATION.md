# U校园 / U校园5.0（AI版）接入说明

当前阶段：**真实课程与服务器状态只读功能已接线，另有未经账号验收的实验性写入代码；两者均不能据此宣称平台进度提交可用。** PR #151 仍为 Draft，不能发布为已完成的 U校园学习助手。

- 用户确认当前使用 U校园5.0（AI版）。
- 已观察到「学习」页面含「校内课程」「自学教程」「作业」「课堂互动」入口。
- 截图显示课程体系/教材、课程名称与记分周期是不同字段。截图仅作为信息架构参考，不将个人课程信息写入仓库、示例课程或默认数据。
- 旧版 / AI 版的课程接口和会话独立处理。当前优先 AI 版。
- 已预留平台注册、凭据配置、只读 JSON 课程列表和单独页面。**不假设**移动端接口、参数、字段或课程进度已验证。
- 登录会话使用 Windows Credential Manager；UI 仅返回配置状态，不回显 Cookie、Authorization。只读模块禁止重定向；另有实验性网络写入模块，尚未通过真实账号的协议兼容与效果验收。

## 下一步真实验收

1. 从用户本人已登录的 U校园5.0 课程列表网络请求中获取打码的 HAR（不要将登录口令、Cookie、Authorization 或学号提交到仓库）。
2. 验证实际请求方法（GET/POST）、域名、参数、返回结构、分页/课程分类与会话过期特征。当前**只读课程及进度适配器**仅支持 GET JSON；仓库另有未经账号验收的实验性写入实现，两者不可混为一谈。若真实接口不是该形式必须修改适配器，不能套用假接口。
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
首页读到空列表才走已知书架接口；这个只读课程列表模块不发送学习行为。仓库另有独立的实验性写入模块，不能据此宣称平台认可虚构学习记录。

- AI版默认首页课程 API 已有可审核的开源来源，无须猜测或手动粘贴 URL。
- 使用者仍须在本机提供有效且由本人持有的会话。是否适用于该账号必须经 Windows 真机验证。
- 章节、资源与服务器状态的只读路径、以及独立的实验性写入调用链已经实现；这些代码**未经 U校园5.0 真实账号验收，不应被视为正式可用的学习进度同步能力**。
- 章节任务状态研究优先参考 `YSJohnson/UnipusAI-Helper`；通用 UI 与任务调度优先复用学序内部实现。
- 账号、会话、接口错误不上传日志或仓库；无需在聊天里共享 Cookie。

## 单元和任务只读读取（基于上游 937725e）

- `ucampus.units.list`：按上游 `course_progress/{course}/{openId}/default` 读取 `rt.units` 键集合；仅标记“单元状态待核验”，不以单元存在推断完成。
- `ucampus.unit.tasks`：按上游单元级 `course_progress/{course}/{unit}/{openId}/default/` 读取 `rt.leafs`；复用 `tab_type`、`strategies.required`、`state.pass` 语义。任务标题缺失时仅显示资源 ID。
- `openId` 仅在本机从会话 JWT 的 `openId` 声明提取，不能当作已认证凭据；会话缺失则返回 `UCAMPUS_OPEN_ID_REQUIRED`，不从别的账号猜测。
- 真实接口需 U校园AI 登录会话和服务端认可的请求头。本节只读适配器不生成心跳；未确认的服务器进度留空。独立本地事件与实验性写入模块另见后文。

## 可选内容接口会话头

`Zzj-klwgxdz/UnipusAI` 的 `src/api/session.rs` 对 U校园AI 内容接口使用
`u-openid`、`x-csrftoken`，以及在有值时使用的
`x-annotator-auth-token`、`u-school`。本次只引入**用户持有的可选值**，
在 Windows Credential Manager 中与当前会话一起保存；前端不持久化或回显这些字段。
本节所述只读进度请求仅发送到固定的 `https://ucontent.unipus.cn`，不跟随重定向；
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

## Socket.IO 传输校验和 Windows sidecar 依赖门禁

客户端将 Engine.IO ping、pong、noop、关闭帧和命名空间拒绝分开处理，
服务器主动事件与未经关联的 ack 不再归类为“已接受”，不会据此更新课程完成率。
新增断线、错误握手、超长响应和异常处理单测。

Windows 构建加入 frozen sidecar `ucampus.heartbeat.capabilities` 探测：
必须确认本地生成器和 `websocket-client` 均可加载，同时
`sender_connected=false`、`server_verified=false`。
这是无账号、无网络的**打包检查**，不是 U校园5.0 真实协议验收。

## 多章节并发调度锁修复

`local_runtime.py` 不再在全局 `RLock` 内等待通信层返回：
不同章节任务的模拟网络 I/O 可以并发，
暂停/停止状态查询也不再被某一项阻塞的通信操作卡住。
锁内只更新本地生成、发送尝试和结果计数；
发送尝试计数在调用前记录，异常不会被统计成服务器认可。
新增双章节同时进入模拟慢发送器的离线回归测试，
不连接 U校园服务器、不生成学习完成状态。

## 真实 U校园服务器进度回读验收入口

本轮新增 `ucampus.progress.verify`：在真实登录会话下，
直接向已知 U校园AI `course_progress` 只读接口查询当前单元的 `state.pass`。
按服务器返回状态汇总通过、未通过、未知以及必修通过数量，
并返回本次 UTC 核验时间。未登录、会话失效、格式异常时返回错误码，
**不会**拿本地心跳生成量或计时冒充服务器认可的学习状态。

课程工作台增加“核验 U校园服务器进度”按钮和独立结果展示；
仅显示数据来源真实的服务器核验项，不把它换算成伪造的整课完成率。
这个接入是生产平台的只读状态核验，而不是向平台虚报学时的上传功能。

## 独立本地事件提交 + 服务器回读协调器

新增 `UCampusSubmissionCoordinator`：由学序自身触发本地事件，
使用已验证的传输适配器执行一次提交，并从真实 `course_progress`
接口取提交前、提交后的服务端任务状态。
成功发送、HTTP 200、WebSocket 消息应答均不直接算作“课程完成”；
只有服务器真实返回 `completed=true` 才反映为服务端已通过，
且前后差异不代表已证明因果关系。

`tests/test_ucampus_submission_end_to_end.py` 以本地模拟 HTTP 服务器回执
测试传输器、学习活动数据校验、提交协调器和平台回读的一整条链路；
测试不会连接真实 U校园，更不会写入平台学习数据。

现有 U校园课程页还支持手动连续两次“核验 U校园服务器进度”，
显示服务器任务从未通过变为已通过的资源差异；
该差异独立于本机模拟事件计数。此功能可以在真实登录后直接使用，
但发送适配器尚无经过 U校园AI5.0 账号核验的生产协议，
因此**当前运行时仍未自动启用学习事件写入**。

---

## 虚构心跳刷完成：GitHub 上游复用清单（2026-11-16）

### 1. 检索结论

GitHub 上存在多家已开发完成的 U校园自动化项目。按「不观看视频、只靠本地虚构心跳让平台记录完成」这一目标筛选，
可复用的成熟实现有两类；其余为答题 / 真实播放器路线，明确不复用。

| 项目 | Star | 许可证 | 路线 | 本次是否复用 |
| --- | ---: | --- | --- | --- |
| [Zzj-klwgxdz/UnipusAI](https://github.com/Zzj-klwgxdz/UnipusAI) @ `937725e` | 186 | GPL-3.0 | Rust，AI 5.0 提交/标记已看 | **复用协议契约**（字段、限频、完成判据） |
| [create-try-now/AutoFinish_UxiaoyuanAI](https://github.com/create-try-now/AutoFinish_UxiaoyuanAI) @ main | 4 | Apache-2.0 | Python，空提交标完成 + 进度回读 | **复用 Python 侧行为**（限频冷却、`pass/pass2/perm` 回读） |
| [ACaiCat/UnipusHelper.NET](https://github.com/ACaiCat/UnipusHelper.NET) @ `3e8492f` | 4 | MIT | C#，`Protocol.cs` | **复用判据**（视频/预置题型 `submitType=2`） |
| [z5882852/unipus-tool](https://github.com/z5882852/unipus-tool) @ main | 47 | 无 LICENSE | Python，WebSocket 虚构时长 | **仅参考事件结构，不复制代码** |
| [YSJohnson/UnipusAI-Helper](https://github.com/YSJohnson/UnipusAI-Helper) @ `fffb882` | 285 | AGPL-3.0 | 浏览器自动答题 | 仅状态模型参考，不复制（避免许可证污染） |
| [hunaol/u_ai](https://github.com/hunaol/u_ai) @ main | 8 | 无 LICENSE | Python，AI 答题 | 仅参考鉴权头形状 |
| [uxudjs/UnipusAIAutoPlayer](https://github.com/uxudjs/UnipusAIAutoPlayer) @ main | 208 | GPL-3.0 | 油猴脚本，真实播放器倍速 | **不复用**（依赖官方播放器，与需求冲突） |
| [CXRunfree/AutoUnipus](https://github.com/CXRunfree/AutoUnipus) @ main | 357 | BSD-3-Clause | Selenium 答题 | 不复用 |
| [NealJun/unipus](https://github.com/NealJun/unipus) @ main | 306 | 无 LICENSE | 老版答题脚本 | 不复用 |

本仓库 `07xh/StudyFlow` 的 `feat/ucampus-fourth-platform-20261116`（PR #151）已有 7 个 U校园模块，
但全部是 **fail-closed 只读骨架**：`transport=None`、`sent=0`、要求真实观看证据、明确禁止把本地时钟当观看时长。
历史分支 `feat/preserve-original-heartbeat-20261114` / `fix/heartbeat-runtime-state-20261115`
只有知到 PowerShell 旧心跳与学习通模块，**没有已开发好的 U校园虚构心跳**。
因此本次是「翻转现有骨架 + 新增虚构链路」，不是从零写播放器。

### 2. 关键协议订正（重要）

早期设计草稿曾设想用 `POST .../newExploration/submit` + `submitType=1`，
并自造 `position` / `duration` / `studyTime` / `sequence` 字段作为逐秒视频心跳。
**核查全部上游源码后确认：U校园AI 5.0 不存在这样的逐秒视频心跳 HTTP 端点。该设计已废弃。**

上游确认的三段式真实契约：

1. **虚构时长（中间心跳）** — 旧版 Socket.IO `wss://ucontent.unipus.cn/unipusio/`，
   命名空间 `/userActivities`，事件 `["start", {module, moduleGroup, client, url, tag1, tag2}]`，
   周期 20s（`z5882852/unipus-tool/ws.py::ws_connect(t=20)`）。全程不打开播放器、不解码媒体。
   本仓库 `socketio_client.py` 是该结构的独立 Engine.IO v3 实现，默认开启 TLS 校验
   （旧源码关闭证书校验，不可复制）。
2. **完成申报（末包）** — `POST https://ucontent.unipus.cn/course/api/v3/newExploration/submit`，
   payload 严格 10 键，键序与 `Zzj-klwgxdz/UnipusAI::build_mark_seen_payload()` 一致：

   ```json
   {"quesDatas": [], "groupId": "<resource leaf id>", "isCompleted": [],
    "thirdPartyJudges": "[]", "submitType": 2, "hideLoading": true,
    "associationGroupId": "", "courseId": "<course instance id>",
    "openId": "<openId>", "version": "default"}
   ```

   上游 README 明确：text/video 类、单词卡、讨论等无可答子题的任务「只调标记已看接口」，
   「单独提交即可 pass=true」。`ACaiCat/UnipusHelper.NET::Protocol.cs` 亦为
   `submitType = preset || type == "video-popup" ? 2 : 1`。
3. **服务端确认（只读回读）** — `GET /course/api/v2/course_progress/{course}/{unit}/{openId}/default/`，
   取 `rt.leafs[id].state.pass`。`UnipusAI` 用 `pass>=1`；
   `AutoFinish_UxiaoyuanAI::fetch_task_completion()` 用更严格的
   `pass==1 && pass2==1 && perm==1`。两者都接受，三标志齐全时按严格判据。

**限频**：响应 `code=600001/600002` 或 `msg` 含「操作过于频繁」→ 递增冷却
（`UnipusAI` runner：180s 递增、最多 5 次；`AutoFinish_UxiaoyuanAI::submit()`：固定 120s 重试一次）。
学序采用 180s 递增、最多 5 次，且重试只重放同一次完成申报，不重复生成中间心跳。

**鉴权头**：复用现有 `course_progress._headers()` 的 `Authorization` / `Cookie` / `u-openid` /
`u-app-id: 39` / `u-platform: 2` / `x-annotator-auth-token` / `u-school` / `Origin` / `Referer`，
POST 时补 `Content-Type: application/json; charset=UTF-8`（与 `hunaol/u_ai::_headers(content=True)` 一致）。

### 3. 学序实现（新增链路，保留原只读骨架）

| 文件 | 职责 |
| --- | --- |
| `src/studyflow/platforms/ucampus/fabricated_heartbeat.py` | 虚构时间线 0→duration、活动事件包、完成包、响应分类、可选的原子快照存储类（未接入默认运行） |
| `src/studyflow/platforms/ucampus/fabricated_transport.py` | 双通道发送器：Socket.IO 中间包 + HTTP 完成包 + 只读回读；限频冷却 |
| `src/studyflow/platforms/ucampus/fabricated_runner.py` | 本地队列、倍速/间隔、进程内暂停/恢复/停止、统计（当前无跨重启续跑） |
| `src/studyflow/services/ucampus_fabricated_bridge.py` | 6 个 `ucampus.fabricated.*` IPC operation，复用长驻 JSONL Sidecar |
| `frontend/src/components/UCampusFabricatedPanel.tsx` | 工作台：包数 / 虚构时长 / 倍速 / 间隔 / 直接申报完成 |
| `tests/test_ucampus_fabricated_heartbeat.py` | 离线回归（注入 socket / post / get / clock，无真实账号与网络） |

状态语义严格分离：

* `sent` = 本地已发出的心跳帧数（含末包）；
* `transport_accepted` = 完成申报返回 `code=0` 的次数，**仅表示已申报**；
* `server_confirmed` / `completed` = 只读回读到 `pass` 标记的次数，**才表示平台确认完成**；
* Socket.IO 的 `unsolicited_event` / `unmatched_ack` 一律不算服务端认可。

接线沿用现有三层：`bridge.py` 路由到长驻 worker、`src-tauri/src/lib.rs` 白名单 + 入参校验 +
退出前 `ucampus.fabricated.stop` 刷盘、`frontend/src/bridge.ts` 类型与中文错误码、
`App.tsx` 在 U校园课程舞台挂载面板。凭据变更（`ucampus.session.configure/clear`）会同时
`reset_runner()` 停旧 worker，避免跨账号串台。

### 4. 许可证与合规边界

* 学序仓库为 GPL-3.0；Apache-2.0 与 MIT 条款可并入 GPLv3 分发，版权与许可证声明保留在本节与
  `docs/LICENSE_PROVENANCE.addendum.md`。
* `z5882852/unipus-tool`（无 LICENSE）与 `hunaol/u_ai`（无 LICENSE）**不复制任何代码**，
  只把公开的事件结构与头字段作为事实参考；`socketio_client.py` 为独立实现。
* AGPL-3.0 的 `YSJohnson/UnipusAI-Helper` 只作状态模型参考，不复制源码。
* GPL-3.0 的 `uxudjs/UnipusAIAutoPlayer` 是真实播放器路线，与「不依赖官方播放器」的架构要求冲突，不纳入。

### 5. 验证边界（如实记录）

已验证：离线注入回归（时间线、包字段、限频重试、`sent`/`accepted`/`confirmed` 分离、
可选状态快照类、进程内暂停/恢复/停止、IPC 参数守卫）、Python `py_compile`、前端 TypeScript 类型检查与构建。

**未验证**：真实账号发包（`code=0` 后 `submitType=2` 是否确实置 `pass=1`）、
旧版 Socket.IO 在 AI 5.0 是否仍计入学时、`x-annotator-auth-token` 有效期、
服务端对 20s 周期与递增冷却的风控阈值。这些必须用本人账号的 HAR 结构摘要与实机联调确认，
文档不宣称已通过平台验收。

## 2026-11-16 状态与安全审计说明

以下区分三个互不等价的事实：

1. **本地模拟**：`local_runtime.py` 与 `UCampusHeartbeatPanel` 的本机事件计数不向平台上传，代表本地练习运行状态。
2. **实验性写入调用**：`fabricated_runner.py` / `fabricated_transport.py` / `UCampusFabricatedPanel` 是不同的模块，包含远端写入尝试；该代码尚未通过 U校园5.0 真实账号验收。文档前面“生产发送尚未上线”仅描述旧版 `local_runtime.py` 入口，不适用于新增模块。
3. **服务器回读**：`course_progress` 返回的任务 `pass` 表明**读取时的服务器状态**；即使操作前后状态改变，也没有充分的证据将变化归因于该次发包。原有变量名 `server_confirmed` 属历史命名，不是请求因果证明，UI 改为“回读已通过（归因未知）”。

生产安全门禁：原始异常文本不得暴露给 IPC、状态文件和 UI，统一映射固定错误码。历史任务快照只能只读查看；不应因进程重启自动补发模拟学习事件。新旧模块应在界面中分别标识本地练习与实验性写入，避免状态混淆。

旧有章节中“只读接入”“不发送学习行为”“尚未开发发送”等措辞是历史开发阶段描述，请以本节的最新代码审计状态为准。

## 2026-11-16 运行状态核验与剩余限制

- **已修正异常泄露**：调度执行、Socket 关闭阶段的异常文本不通过 IPC、
  用户界面或状态字段显示，只使用固定错误码。
- **已澄清服务器结果**：通过标志只是读取时服务器的快照，
  变量 `server_confirmed` 为兼容历史保留，不能证明当前发送导致状态变化。
- **已区分界面**：本地练习模块不会向平台发送，实验性写入模块可能进行网络请求。
  两套模块各有独立状态、任务与操作区域，不能合并计数或称作正式学习完成。
- **跨重启恢复未实现**：`FabricatedStateStore` 只是一个可选 JSON 快照存储工具；
  默认的 `FabricatedRunner` 没有注入它，也没有从 `load()` 读取任务重建运行。
  UI 的“恢复”仅指**同一进程内解除暂停**，绝不代表跨进程续传。
  状态接口返回 `restart_resume_supported=false`；不自动重放网络学习事件。
- Python 回归和前端测试只能证明本机代码行为，无法代替 U校园5.0 真实账号及
  服务器进度验收。实验性写入不能作为已完成课程的证据。
