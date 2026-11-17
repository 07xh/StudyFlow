# U校园5.0（AI版）接入现状

> 最后整理：2026-11-17。本文只记录当前代码结构和可核验状态，历史探索性假设不作为生产契约。
> **状态：支持应用内官方 WebView2 扫码/验证码窗口及本机 JWT 导入，仍需本人账号核验 JWT 是否生成并能回读课程；账号密码和手动 Cookie 仍作为备用。自动化通过不能替代真实账号与服务器验收。**

## 功能边界与当前入口

| 功能 | 代码位置 | 状态 |
| --- | --- | --- |
| AI版课程/书架读取 | `platforms/ucampus/adapter.py` | 真实 API 只读实现，待账号验收 |
| 单元、资源、通过状态 | `platforms/ucampus/course_progress.py` | 真实 API 只读实现，待账号验收 |
| 凭据保存、状态查询和删除 | `platforms/ucampus/credentials.py` | Windows Credential Manager；不回传原始凭据 |
| 应用内 SSO 账号密码登录 | `platforms/ucampus/sso_login.py` → `ucampus.session.login` → `UCampusLoginPanel.tsx` | 使用参考项目记录的 U校园AI 官方 SSO 登录接口；本机登录、仅保存返回的 JWT 会话，**待真实账号验收**；验证码/限流不绕过 |
| 账号页验证课程接口 | `UCampusLoginPanel.tsx` → `courses.list` | 主动执行一次真实目录 GET；识别会话过期、格式不匹配及空课程，**不把配置成功当成登录成功** |
| 本地模拟事件 | `platforms/ucampus/local_runtime.py`、`services/ucampus_runtime_bridge.py` | 不发送学习事件；与课程完成无关 |
| 旧版 Socket.IO 诊断 | `platforms/ucampus/socketio_client.py` | 手动认证握手，不发送学习事件 |
| 独立 HTTP 契约研究层 | `platforms/ucampus/send_transport.py`、`submission_coordinator.py` | 未注册生产协议；只在单测中使用 |
| 实验性网络运行模块 | `fabricated_heartbeat.py`、`fabricated_transport.py`、`fabricated_runner.py`、`services/ucampus_fabricated_bridge.py` | 有独立写入调用链；**未经 U校园5.0 账号及进度效果验收** |
| React UI | `UCampusCourseDetailPanel.tsx`、`UCampusProgressVerifyPanel.tsx`、`UCampusFabricatedPanel.tsx` | 已移除纯本地练习 UI，服务器进度查询独立呈现；实验模块仍隔离 |

`services/bridge.py` 提供统一 JSONL IPC；`src-tauri/src/lib.rs` 对操作与请求范围进行校验。
`App.tsx` 现在挂载独立的**服务器只读进度核验**及实验性事件模块；旧版 `UCampusHeartbeatPanel.tsx` 本地练习 UI 已删除。`local_runtime.py`、`ucampus_runtime_bridge.py` 目前保留为后端兼容代码，不在前端展示，也不能用于判定观看完成。

## 账号登录边界

- U校园5.0 / AI版的账号密码登录通过固定 `https://sso.unipus.cn/sso/0.1/sso/cip/login` 执行；AES-CBC/PKCS7 字段封装来自已登记的 GPL-3.0 参考实现。**协议可用性须经本人账号验收**。
- 不保存密码、用户名或 SSO refresh token；成功时仅保存 SSO 返回的 JWT Cookie 到 Windows 凭据管理器，不把密码返回前端或日志。会话过期后需要重新登录；不承诺自动续期。
- 登录后使用固定的官方账号信息只读 GET（`/api/account/user/info`）尝试读取 `value.userInfo.school`；仅在值为有限长度的数字学校编号时保存，失败时保留 JWT 会话，不构造学校编号。
- 用户实测的账号登录验证码为**图片/数字验证码，不是手机短信验证码**。官方 WebView2 登录窗口直接呈现 U校园网页，由本人在网页内查看图片并手动输入数字/字符；不在学序另造验证码图片或自定义提交接口。独立的扫码登录仍作为可选方式。
- 后端直接账号密码 SSO 请求如返回 `UCAMPUS_LOGIN_VERIFICATION_REQUIRED`，前端会自动打开官方登录窗口让用户重新在官网完成图片/数字验证码，不尝试猜测挑战参数、自动识别、绕过或无限重试。登录完成后仍需本机导入会话和真实课程回读。
- 官网 [Unipus SSO](https://sso.unipus.cn/sso/login) 提供二维码扫码登录。学序现在提供**独立的官方 WebView2 登录窗口**：用户自行完成官方扫码/验证码后，点击“导入并验证会话”时由 Rust 原生层检查该窗口在 `uai.unipus.cn` 下的 JWT Cookie，符合格式才传给本机 Python sidecar，保存到 Windows 凭据管理器；Cookie/JWT 不返回前端。首次使用、域名跳转及具体学校账号是否设置 JWT Cookie 仍待 Windows 实机验收，不能将打开窗口或扫码完成当成已登录。系统浏览器仍不能向学序自动同步 Cookie，可在本机手动导入本人 Cookie 作为备用。
- 内嵌官方登录仅允许访问固定的 U校园第一方 HTTPS 域名，窗口标签不授予 Tauri IPC capability，令牌不会进入页面 JavaScript/日志。成功导入或主动关闭时尽力清理 WebView2 浏览数据。
- 2026-11-17 UI 修复：原 `details` 内 `label` 与 `input` 默认行内布局造成长标签和输入框互相挤压，已改为表单字段上下排列、可换行的官方登录链接。手动导入支持清理粘贴的 `Cookie:` 请求头前缀。
- 后续加固：官方 WebView2 登录窗使用 `incognito(true)`，在受支持的 WebView2 运行时中关闭即丢弃私密会话；主动退出时会调用原生清理并关闭官方窗口，异常时界面明确提示。原 `data_directory` 仍用于隔离，部分旧版 WebView2 可能不支持私密模式；需要 Windows 实机验证，不将本机清理声称为官方服务器注销。
- 导入窗口会话时，Rust 只解析 JWT 的 `exp` 作为**未经签名验证的本地过期提示**；已过期会话拒绝导入且不替换 Windows 凭据。Python 的 `ucampus.session.info` 只向界面返回 `jwt_lifetime`（`expired/expiring/not_expired/unknown`），不包含原始令牌。课程、进度只读请求在本地已知过期时提前停止，服务端认证仍由实际接口响应判定。
- 账号界面优先展示官方登录，高级手动 Cookie 表单默认折叠；设置里明确区分“保存会话”“JWT 自报有效期”和“课程接口读取成功”，不把本地令牌自报未过期等同于真实登录。
- 账号密码登录或手动导入 Cookie 保存成功后，均自动执行一次**真实课程目录读取**并显示数量或失败原因；也可使用“验证课程读取”按钮复核。保存成功、HTTP 成功或课程空列表都不被误判为平台登录完成。
- 实际 U校园AI `course-v2` ID 可包含 `+` 分隔符：Python 和 Rust 只读 IPC 已支持字面 `+`，仍拒绝斜杠、百分号、查询字符及控制字符。

## 重启后恢复：仅用于服务器只读核验

- 用户在 **U校园 → 课程详情 → 服务器进度核验** 显式启用。保存课程 ID、单元 ID、会话 SHA-256 标记及最后一次只读状态，不保存 Cookie、密码、JWT、媒体位置或伪造的观看记录。
- 应用启动并完成隐私授权后，以及应用运行期间每 90 秒触发一次 `ucampus.monitor.tick`。Python 模块至少隔 60 秒才执行新的服务器 GET；保存请求时间防止重启后连续读取。
- 当前只有一个选中的 U校园课程单元监控目标；重新启用其它单元会替换原目标。账号切换或退出会清除监控；会话标记不匹配时停止读取，避免跨账号误用。
- 核验失败则标记明确错误或待核验，不改变服务器学习状态，也不补发模拟心跳或申报完成。
- **“重启后自动续核验”指下次打开学序后继续只读查询，不表示 Windows 开机自启动、后台常驻，亦非本地心跳任务断点续传。**
- 这部分有离线回归验证，但实际账号能否读取 U校园AI 的当前 `course_progress` 接口仍需用户本机核验，不能据 CI 结果宣称完成生产接入。

## 本地练习与服务器状态的区别

- 原本地练习的 `generated`、`pulses_per_resource` 只表示模拟事件数量；相应 UI 已移除，不再占用课程页面。
- 后端兼容用的纯本地运行器 `sent=0`、`server_confirmed=null`；其入口不再由页面触发，也没有注册网络发送器。
- 实验模块的 `sent` 是发送帧/尝试数，`transport_accepted` 是响应分类；这两个值**均不是**平台已完成的证明。
- 历史字段 `server_confirmed` 反映的是读取时服务器记录的通过状态，**不证明**状态由当前某次请求造成。UI 使用“回读已通过（归因未知）”。
- 独立只读入口 `ucampus.progress.verify` 查询课程任务状态；前后两次快照有差异也不能自动认定因果关系。
- `ucampus.socket.diagnose` 仅测试旧版认证/连接；握手成功不代表 AI 5.0 学习协议兼容。

## 安全与本地历史

- Cookie、Authorization、annotator token 与账号关联材料不进入前端本地存储、运行结果或用户界面。
- 网络请求应使用固定第一方域名、有效会话、TLS 验证、超时及禁止重定向的约束。
- 原始网络异常正文不能写入 IPC 状态或历史文件；异常只对外返回固定错误码。
- `FabricatedStateStore` 的保存、旧文件迁移、删除和历史列表读取**共用字段白名单**，只保留合法的课程/单元 ID、运行阶段和有限范围的 `generated/sent/accepted/confirmed` 计数；不保留视频标题、会话令牌或原始异常。
- 旧 JSON 历史会在存储器初始化时按同一白名单脱敏；无法解析的旧文件保留，不擅自删除用户数据。
- `ucampus.fabricated.history` 只读列出历史快照。状态为“运行中”的旧记录显示为“中断”；**不自动恢复、不补发网络事件**。进程内“恢复”仅指解除暂停。
- 凭据切换时分别重置两套运行器，防止旧账号状态穿透新会话。

## 自动化检查与真实验收

自动化层覆盖 Python 课程解析、状态、错误分类、历史存储和 IPC；前端覆盖页面与 IPC 契约；
Windows 层检查 sidecar/NSIS。CI 通过只能说明本仓库代码和打包流程通过。

正式验收尚需使用本人账号在 Windows 上核对：课程列表、单元/资源、服务器状态及其刷新、会话过期；
断线及错误信息不会泄露凭据；本地历史与运行状态独立；
最后核对安装、升级和卸载的完整性。

**不得因 HTTP 成功、Socket 连接、离线 mock 测试或本地事件生成，就宣称 U校园已接受学习记录。**
截至本文整理时间，实验性写入仍缺少能支持此结论的生产验收证据。

## 模块复用与许可证

| 参考来源 | 固定版本/许可证 | 当前使用方式 |
| --- | --- | --- |
| [Zzj-klwgxdz/UnipusAI](https://github.com/Zzj-klwgxdz/UnipusAI/tree/937725ede225f63e7746f11c0ff6ac297e524909) | `937725e` / GPL-3.0 | AI课程与进度字段参考 |
| [YSJohnson/UnipusAI-Helper](https://github.com/YSJohnson/UnipusAI-Helper/tree/fffb882adf5d1d35c259bc5b653273f0eac094c9) | `fffb882` / AGPL-3.0 | 状态模型参考，未直接复制 |
| [ACaiCat/UnipusHelper.NET](https://github.com/ACaiCat/UnipusHelper.NET/tree/3e8492fab6aa0bbaa72aecf60fead39a7248ac21) | `3e8492f` / MIT | 结构参考 |
| [create-try-now/AutoFinish_UxiaoyuanAI](https://github.com/create-try-now/AutoFinish_UxiaoyuanAI) | Apache-2.0（原研究登记） | 实验性历史研究，非真实账号验收 |
| [z5882852/unipus-tool](https://github.com/z5882852/unipus-tool) | 未见 LICENSE | 旧版网络研究，不复制源码 |
| [hunaol/u_ai](https://github.com/hunaol/u_ai) | 未见 LICENSE | 参考请求结构，不复制源码 |
| [uxudjs/UnipusAIAutoPlayer](https://github.com/uxudjs/UnipusAIAutoPlayer) | GPL-3.0 | 未集成 |

历史研究文档中对平台协议的推断，不替代真实账号验证。第三方代码版权及完整许可登记以
`docs/LICENSE_PROVENANCE.md`、`docs/LICENSE_PROVENANCE.addendum.md` 为准。

## 文档维护原则

后续功能修改应直接更新对应章节及验收状态，不要再追加同一天的“进度更新”段落。
已验证、仅有代码、真实账号待验三种状态必须分别记录；
项目中所有媒体平台统一沿用这一原则。

## UI 清理记录（2026-11-16）

- 删除 `frontend/src/components/UCampusHeartbeatPanel.tsx`，保留 `ucampus.progress.verify` 与真实单元选择为新的 `UCampusProgressVerifyPanel.tsx`。
- 旧版 WebSocket 诊断放入折叠区域；仅连接认证，不发送学习事件。
- 只读面板保留服务器快照计数、必修统计、未知状态、逐资源状态与前后快照差异；切换课程或单元时丢弃过期异步响应。
- 纯本地模拟按钮、参数、进度条与任务列表均从 UI 移除。保留后端 `LocalPulse` 类型及兼容入口，避免破坏当前其他模块引用。
- 实验性网络模块未经真实账号验收；此 UI 清理不变更其代码、发送协议或服务器回读机制。

- 2026-11-17 二维码窗口修复：原内置 WebView2 始终加载 `https://uai.unipus.cn/`，与独立扫码入口不对应。现在“打开二维码登录”使用独立 `ucampus-official-qr` 窗口直接加载官方 `https://sso.unipus.cn/sso/login`，而账号/图片数字验证码使用原 `ucampus-official-auth`。两种登录窗口使用各自的私密数据目录，导入时只读取所选窗口中的 AI JWT，二者不可混用。
- 该 SSO 页面“扫码登录”和“刷新二维码”按钮确实存在，但二维码是否由 WebView2 正常渲染、扫码后能否在同一个窗口得到 `uai.unipus.cn` 的 JWT，仍需真实 Windows 账号验证。若 SSO 扫码完成但没有 AI JWT，明确报会话未找到，保留系统默认浏览器与本人手动 Cookie 备用，**不把扫码状态当成课程接入成功**。
- 原内置窗口的创建/显示和会话导入后的 WebView2 清理可能同步阻塞 IPC。现在相关原生操作移至 Tauri 阻塞线程池；主界面不会因为这些同步调用直接阻塞。尚不能仅凭 CI 证明用户遇到的 Windows 闪退根因已完全排除，如仍退出需脱敏事件查看器日志与 WebView2 版本进行实际诊断。窗口拒绝导航到未知域名，二维码图片使用的官方 `birdflock.unipus.cn` 作为已知资源来源保留到允许域名列表。

## 课程已显示但单元验证失败（内容侧认证）

- U校园AI 的课程首页接口位于 `uai.unipus.cn`，课程单元与服务器进度来自独立的 `ucontent.unipus.cn`。两者认证要求不同，因此“课程列表出现”不等于“内容进度已可核验”。
- 此次根据已有 UnipusAI 的公开客户端协议补齐内容侧 `appid` 和 `x-annotator-auth-token`。内容侧的短期客户端令牌**只依据当前本机已配置 SSO JWT 中的 openId 构造**，仅用于本人只读内容查询；不保存其副本，不自动修改用户在高级设置中显式导入的令牌，且不能作为通过官方服务器认证的证明。该公开协议随官方前端变更可能失效；任何真实结果必须由官方接口响应核验。
- 官方登录窗口（扫码或账号）导入 Cookie 时与直接 SSO 登录一样尝试查询官方用户资料中的学校编号 `school`，仅当返回合法编号才补入 `u-school`；查询失败不破坏原有会话，也不返回账号信息到 React。
- `ucampus.session.info` 仍只代表本机凭据状态；登录后“验证课程读取”继续读取课程目录，并在至少一门真实课程可用时再发起**一次**对应课程的只读单元 GET。UI 分别展示目录成功和内容侧是否通过，不把空单元、课程名称或未核验的任务当作完成证据。
- HTTP 401/403 来自 **ucontent 内容接口**时不再直接解释为“U校园整体登录过期”：401 映射为 `UCAMPUS_CONTENT_AUTH_REJECTED`，403 映射为 `UCAMPUS_CONTENT_ACCESS_DENIED`；只有已知 JWT 过期或课程目录接口明确拒绝会话才保持 `UCAMPUS_SESSION_EXPIRED`。这些状态不包含原始 Cookie、JWT 或响应体。
- Windows 真机验收仍需：账号登录/扫码 → 导入并验证 → 实际读取课程 → 实际读取课程单元 → 切换课程 → 重启 EXE 再次验证。若内容接口仍拒绝，不反复虚报“已修复登录”，而应在本人授权环境中核对服务端授权要求、是否具有该课程权限及已脱敏的状态码；不要将任何 JWT/Cookie 发到聊天中。
