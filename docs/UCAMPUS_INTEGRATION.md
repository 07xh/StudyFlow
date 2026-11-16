# U校园5.0（AI版）接入现状

> 最后整理：2026-11-16。本文只记录当前代码结构和可核验状态，历史探索性假设不作为生产契约。
> **状态：PR #151 为 Draft。自动化通过不能替代 U校园账号与服务器验收。**

## 功能边界与当前入口

| 功能 | 代码位置 | 状态 |
| --- | --- | --- |
| AI版课程/书架读取 | `platforms/ucampus/adapter.py` | 真实 API 只读实现，待账号验收 |
| 单元、资源、通过状态 | `platforms/ucampus/course_progress.py` | 真实 API 只读实现，待账号验收 |
| 凭据保存、状态查询和删除 | `platforms/ucampus/credentials.py` | Windows Credential Manager；不回传原始凭据 |
| 本地模拟事件 | `platforms/ucampus/local_runtime.py`、`services/ucampus_runtime_bridge.py` | 不发送学习事件；与课程完成无关 |
| 旧版 Socket.IO 诊断 | `platforms/ucampus/socketio_client.py` | 手动认证握手，不发送学习事件 |
| 独立 HTTP 契约研究层 | `platforms/ucampus/send_transport.py`、`submission_coordinator.py` | 未注册生产协议；只在单测中使用 |
| 实验性网络运行模块 | `fabricated_heartbeat.py`、`fabricated_transport.py`、`fabricated_runner.py`、`services/ucampus_fabricated_bridge.py` | 有独立写入调用链；**未经 U校园5.0 账号及进度效果验收** |
| React UI | `UCampusCourseDetailPanel.tsx`、`UCampusHeartbeatPanel.tsx`、`UCampusFabricatedPanel.tsx` | 两种模式仍分别挂载；不可合并状态 |

`services/bridge.py` 提供统一 JSONL IPC；`src-tauri/src/lib.rs` 对操作与请求范围进行校验。
`App.tsx` 目前同时挂载“本地心跳练习模式”和“实验性事件模块”，**两者均为使用中的代码，不是可直接删除的旧面板**。

## 本地练习与服务器状态的区别

- 本地练习的 `generated`、`pulses_per_resource` 和进度条只表示模拟事件数量；它不是播放时间、完成率或成绩。
- 本地练习的 `sent=0`、`server_confirmed=null`。这个运行器没有注册网络发送器。
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
