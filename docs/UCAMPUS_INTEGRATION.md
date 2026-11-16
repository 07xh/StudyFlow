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
