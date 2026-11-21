# StudyFlow × OCS 代码兼容性与去重审查（第一阶段）

> 2026-11-21；与 [后台静默执行开发计划](OCS_STUDYFLOW_BACKGROUND_INTEGRATION_PLAN.md) 配套。  
> 检查依据：StudyFlow `main` @ `ce5968f`；OCS `ocsjs/ocsjs` 默认分支代码。  
> **完成的是源代码静态审查和文件对应，不是运行验收或 OCS 模块移植。**

## 1. 已核实的架构基线

| 项目 | 源码证据 | 现状与处理 |
| --- | --- | --- |
| 本地 JSONL 协议 | `src/studyflow/services/bridge.py::dispatch`、`src-tauri/src/lib.rs::bridge_request` | 已存在，**不新增** OCS 本地 HTTP 桥 |
| 学习通长驻执行 | `services/xuexitong_heartbeat_bridge.py`、`platforms/xuexitong/service.py` | 进程内单例和队列；只做向后兼容调整 |
| 学习通任务卡解析 | `platforms/xuexitong/taskparse.py` | 已具备 mArg 平衡解析、字段归一和视频/音频迭代；**不能再复制一套解析器** |
| 学习通课程/章节/任务 | `platforms/xuexitong/adapter.py` | 已有基于真实页面和会话的读取链；可针对真实漏任务案例补回归 |
| 学习通运行/恢复 | `platforms/xuexitong/{runner.py,state.py,service.py}` | 已有暂停、恢复、状态落盘、账号域隔离；不引入 OCS worker |
| 知到原执行链 | `services/{zhs_queue.py,legacy_playback.py}` 和 `platforms/zhidao/zhs_scope.py` | 维护现有 ZHS 实现，不替换，不新增竞争式执行器 |
| 雨课堂只读读取 | `platforms/yuketang/readonly.py` | 已有课堂/章节/视频进度读取；先查缺漏再补 |
| U校园只读进度 | `platforms/ucampus/course_progress.py` | 已有单元/任务解析；不是 OCS 现成覆盖平台 |
| UI 与类型 | `frontend/src/{bridge.ts,runtimeTasks.ts,progressMerge.ts,taskRecovery.tsx}` | 继续复用，不引入 OCS 面板 |
| 测试 | `tests/test_xuexitong_platform.py`、`tests/test_xuexitong_bridge.py`、`tests/test_zhs_queue.py` 等 | 项目已有针对 mArg 嵌套对象、课程读取、状态与调度的回归入口 |

**特别说明：** 现有学习通 `XuexitongHeartbeatService.start()` 对“正在运行”有拒绝逻辑，但这不足以证明所有平台已共享一套全局任务互斥；跨服务去重仍是待实现/待验证事项。

## 2. OCS 逐文件审查

| OCS 文件 | 当前依赖特征 | 与 StudyFlow 重合 | 决策 | 后续行动 |
| --- | --- | --- | --- | --- |
| `packages/scripts/src/projects/cx.ts` | `easy-us`、页面 DOM、全局 `top.jobs`、播放器控制；含 `Attachment` 资源类型定义 | StudyFlow 已有 mArg/任务归一/课程发现/长驻调度 | **B：选择性参考** | 对比 `insertbook/insertdoc/insertflash/work/insertaudio/insertvideo` 与现有 `taskparse.py` 的资源分类；仅对实际漏识别情形补纯解析测试 |
| `.../zhs.ts` | 多种页面处理器、`document.querySelector`、远程页面/播放器控制 | StudyFlow 已有 ZHS `zhs_scope.py`、`zhs_queue.py` 与原版执行器 | **C：仅参考分类** | 比对智慧课程不同页面的资源类型；不得替换原有 ZHS 心跳/调度 |
| `.../yuketang.ts` | `Project/Script` 框架、DOM、PPT/课程界面逻辑 | StudyFlow 有原版雨课堂执行器和 `readonly.py` | **B/C：参考元数据** | 对照教材/视频/PPT/图文资源标签；先补官方只读状态覆盖，避免新增 DOM 自动操作链 |
| `.../icourse.ts` | 依赖 SPA 路由 `location.hash`、DOM、页面播放器与辅助远程页面 | StudyFlow 尚无对应正式平台目录 | **D：待研究的新平台** | 只能以路线/页面结构为线索；优先账号授权范围内的只读课程与任务元数据，不能称已有纯后台能力 |
| `.../icve.ts` | `document.querySelector`、`DOMParser`、iframe 与网页媒体 | StudyFlow 尚无对应平台目录 | **D：待研究的新平台** | 先分离纯解析与会话读取，再评估是否能无窗口调用 |
| `.../zjy.ts` | 文件注释明确提出跨域 iframe + **新建小窗口 / window.opener** 协调 | 与“只用 StudyFlow、无 OCS 独立窗口”冲突 | **X：排除窗口实现** | 只可参考资源分类与课程身份字段，禁止照搬窗口调度链 |
| `packages/core/src/core/worker/worker.ts` | `easy-us` 事件/UI、DOM root observer、页面题目元素 | 与 StudyFlow 后台 Sidecar 生命周期不匹配 | **X：不复用 worker 框架** | 不引入整套 OCS worker；纯数据工具若有独立价值再逐函数审查 |

决策：**A** 可直接作为纯数据函数使用（本轮未发现必须立刻新增的 A 类实现）；**B** 可人工选取并改写为 Python 纯函数；**C** 只参考业务判据；**D** 后续研究；**X** 明确不采用。

这份审查不能仅凭文件包含 `fetch` 或 `querySelector` 就断言全部逻辑不可复用。实际复用必须定位到**具体函数、输入输出、调用依赖和真实样本**。

## 3. 不重复造轮子的具体结论

1. **不重新开发 mArg 解析器。** StudyFlow 已有 `extract_marg_payload`、`normalize_card_fields`、`iter_media_cards`；既有 `tests/test_xuexitong_platform.py` 包括嵌套对象和引号/花括号测试。
2. **不新建第二个 Python 服务。** 学习通长期运行由 `xuexitong_heartbeat_bridge.py` 承担；Rust JSONL 桥已经具备操作白名单。
3. **不改写 ZHS 原版心跳和既有多并发调度。** 只分析 OCS 可提供的资源类型/状态判据差异。
4. **不移植 `OCSWorker` 或 OCS 用户脚本 UI。** 其框架与页面和 DOM 生命周期耦合，违背无独立窗口、统一 StudyFlow 控制面的要求。
5. **增量平台先只读。** 中国大学 MOOC、智慧职教、职教云的课程/章节解析都需要真实授权会话测试，不以油猴能打开网页作为后台支持证据。
6. **服务器证据不混淆。** 本机运行、请求回执、平台答复、官方只读记录分离，未确认必须展示未知/待核验。

## 4. 从审查进入 P0 最小代码补丁的待办

| 顺序 | 需要处理的差异 | 首选落点 | 验收条件 |
| --- | --- | --- | --- |
| P0-A | 学习通非视频/音频资源类型识别覆盖度 | `taskparse.py`、`adapter.py`；复用旧函数 | 真实或脱敏固定样本证明漏识别；单测检查 video/audio/document/PPT/quiz 分类，不变更执行链 |
| P0-B | 平台间任务身份和状态命名不完全统一 | 复用 `core.models`、现有 UI 类型及桥接契约 | ID 是字符串，跨账号不会串任务，未核验进度不冒充完成 |
| P0-C | 同平台或跨调度服务重复派发 | 先审查现有队列与持久化进程锁，再最小修复 | 同资源在相同授权账号下不能由两个入口重复启动；不同资源原有并发能力不受影响 |
| P0-D | 执行器在最小化/托盘常驻期间的生命周期 | Rust Sidecar、NSIS 和托盘行为 | 任务持续、无黑色控制台/无 OCS 窗口，主界面恢复时能刷新状态 |
| P0-E | 官方回读和缓存的时效显示 | `progressMerge.ts`、各平台只读适配 | stale/verified_at 正确；服务器未确认不得显示已完成 |

**先做 P0-A 的只读解析测试，不碰发送逻辑。** 若经真实样本检查确认已覆盖，不为凑开发量新增代码，直接转向 P0-B/C。

## 5. 许可证与交付边界

- OCS `LICENSE` 是 MIT（版权声明 `Copyright (c) 2022 enncy`）。实际复制代码时须在相应文件或第三方来源文档中保留声明及许可；不能因 StudyFlow 自身 GPL-3.0 而省略来源。
- OCS 的页面界面、脚本框架、答题 worker 并非必需依赖；不得把它们打包为新窗口或变成开机前置服务。
- 初版只进行本地离线样本单测和功能契约测试；真实账号的课程、完成状态与后台生命周期属于单独真机验收。
- 本文件不是“已接入/已发布”声明，**不包含运行代码提交，也未启动或自动完成任何学习任务**。

## 6. 下一轮 PR 的建议范围

**一个最小功能/兼容性 PR：** 聚焦学习通资源分类的脱敏样本测试或确切缺陷修复；如无缺陷，则先实现/测试统一任务身份校验。不得同时引入浏览器脚本桥、OCS GUI 和新的调度器。
