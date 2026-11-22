# StudyFlow 共享题库服务：Windows EXE 本地调用

从 rc.58 开始，**言溪只是第一个题库来源**，题库统一由
`studyflow.services.question_bank` 管理，供任意课程练习/作业 UI 复用。

## 使用方式

- 「设置 → 题库中心」：一级页面展示所有题库来源、Token 数、已识别可用数和有记录的总余量；点击对应来源的「管理」进入二级浮窗，批量导入、策略和单条管理都在其中。**主设置已移除手动搜题表单**，不影响习题组件和后端通用查询。每个来源展示由适配器提供的**官网链接**，在系统默认浏览器中打开。
- 「知到 → AI 掌握度 → 单道练习题」：每道题下方有「题库查题」，展开后选择题库/Token，再点击「查询这道题」。
- 将来普通知到作业、雨课堂习题、学习通作业有真实题目 UI 时，可以复用组件，不再单独编写言溪前端：
  `<QuestionBankQuestionAction desktop={desktop} question={normalizedQuestion}/>`。
- 后端 IPC：`questionbank.providers` / `questionbank.tokens.list` /
  `questionbank.tokens.add` / `questionbank.tokens.import` / `questionbank.tokens.rotation` /
  `questionbank.tokens.check` / `questionbank.tokens.select` /
  `questionbank.tokens.remove` / `questionbank.query`。
- 标准题目格式为 `{title, question_type?, options?}`，
  `options` 支持普通字符串或 `[{key,text}]`。平台 Cookie、账户 ID 和作业提交字段一律不进入此查询对象。

示例调用（仅题干与选项）：

```ts
const reference = await questionBankQuery("yanxi", {
  title: question.content,
  question_type: "单选",
  options: [{key:"A", text:"选项一"}, {key:"B", text:"选项二"}]
});
```

## 同一题库多 Token 批量导入与使用策略（V2）

- 在「设置 → 题库中心 → 对应题库 → 管理」内，将所有 Token 粘贴到同一个多行框，**每行一条**，忽略空行。
- 点击「批量导入并加密保存」后一次性校验、去重、加密入库。无效条目整批拒绝，不会部分保存。
- 每个来源最多 100 条。新导入后超过 1 条时默认开启自动轮流模式；旧版保存的配置继续保留固定默认模式。
- 「自动轮流使用」指每次新查询选择下一条 Token。本次查询失败、网络超时、429、鉴权失败或额度耗尽，都不会立即使用下一条重试。
- 普通单题查题与知到掌握度默认继承来源 Token 策略，也可以手动固定某一条。
- 列表仅回显 Token 备注；输入框保存后清空。Windows DPAPI 继续加密保存密钥。
- 新增 questionbank.tokens.import（provider_id、lines）与 questionbank.tokens.rotation（provider_id、mode）操作；旧的 add/select/remove/query 保持兼容。

## Token 可用性与额度诊断

- 一级总览提供「检测全部」和「检测并更新余量」两个操作。前者逐条检测可用性并显示整体进度，不读取可能收费的余额；后者须再次明确确认，逐条检测并尝试获取额度。所有题库的检查均通过各自适配器，不支持诊断的来源暂不计入待检数量。
- 二级浮窗保留单条 Token 的「检测」入口。
- 前者利用当前言溪服务返回的认证/参数错误信息判断是否识别该 Token。此方式来自既有客户端行为，**不是题库服务官方稳定的验证协议**；结果分「服务已识别 / 可能无效 / 无法确认 / 未检测」，网络错误不能当作无效。
- 额度操作仅在用户确认后，先进行同样的验证，再尝试一次可能收费的题库查询，从响应 `data.times` 提取余额；若未返回，则余量显示「未知」，绝不伪造 0。全局「已知剩余总量」只累计未判无效、已取得数值且单位相同的 Token，同时展示覆盖条数；不同单位则要求分题库查看。
- 普通题目查询如果直接得到 `data.times`，会将其作为最近一次已知余量缓存，不需要再做付费检查。保存 Token、打开设置、切换题库时不自动触发诊断。
- 诊断时间、已知剩余次数等状态随 DPAPI 保险库保存；完整 Token、原始错误正文和响应 URL 不回传前端或写日志。误报不会自动删除凭据。
- 当前仅言溪来源实现此实验性诊断，其他提供方需有各自的已验收状态/余额适配器。

## 旧版独立言溪 IPC 下线与数据迁移

- 自 rc.61 后的代码整理起，删除不再使用的 `questionbank.yanxi.status/save/clear/query` 独立 IPC 及前端专属包装；新调用统一经过 `questionbank.tokens.*`、`questionbank.query`。
- 言溪适配器不再自行保存或删除 Token，也不能在查询中绕过统一保险库读取单独的 Token；所有查询都必须由统一服务显式传入选中凭据。
- **不会删除旧版用户凭据**：保留只读 `yanxi.dpapi` 解密入口，只有迁移到 `providers.dpapi` 并成功写入后才尝试移除旧文件；新保险库出现异常时不得清空或重建旧文件。
- 原始 `legacy/zhidao`、`legacy/yuketang` 和历史发布记录继续保留：其中部分代码仍用于打包、播放和原功能兼容，不按文件名或历史日期直接删掉。
- 旧言溪 IPC 清理及题库中心统一已经随 rc.62 代码整合；是否有可用安装包以对应 GitHub Release 附件为准，历史 rc.61 安装包不包含此清理。

## 多 Token 与存储

- 采用 Windows 用户级 DPAPI 加密整个保险库：
  `%LOCALAPPDATA%\StudyFlow\question-bank\providers.dpapi`。
- 每个提供方最多 100 条 Token；Token 有独立 UUID 和可读备注。
  默认 Token 仅用于用户**显式发起**的查询；也可以按题指定另一条 Token。
- 首次读取自动迁移 rc.57 的 `yanxi.dpapi`。
  先加密写入新保险库，确认成功后再删除旧文件。
- 可按来源选择固定或轮流 Token，但不会因配额或限流自动重复请求。
- 列表 API 只返回提供方、Token ID、备注和默认状态，永不回显明文 Token。
- 题目/答案不写入保险库；没有云端同步，也不需要 Cloudflare。
- 此 Windows 用户身份下运行的其他本地进程仍可能访问用户级 DPAPI 数据；不是防恶意程序隔离技术。

## 扩展其他题库

在 `question_bank.PROVIDERS` 注册另一个固定提供方的
`name`、`description`、`homepage`（题库官网 HTTPS 地址）、`quota_unit`（例如「次」）、`lookup(title,options,type,token=...)` 适配器。可选 `check(token,include_quota=...)`，未提供则界面不启用该来源的批量健康检查。
提供方接口自己处理上游协议与响应格式。新增适配器后，
全局设置、Token 管理与所有题目行的 UI 自动显示新提供方。

不能由任意输入动态指定服务器 URL，避免代理任意请求或向非预期域名泄露 Token。

## 结果边界

外部题库只返回**未经平台核验的参考答案**。不会修改知到/学习通/雨课堂
的官方习题保存、提交、心跳、成绩或 SQLite 官方判分题库。

实时请求会发送题干、选项和所选 Token 给第三方题库，可能消耗额度。
言溪当前公开适配器仍是 HTTPS GET，因此 Token 可能出现在言溪服务器访问日志中。
未对用户实际 Token 或所有上游额度计费情况做在线验收。

## 测试

- `pytest -q tests/test_question_bank.py tests/test_yanxi_question_bank.py`
- `npm --prefix frontend test`
- `npm --prefix frontend run build`
- Windows CI 继续验证 NSIS 完整安装、升级、启动、卸载。
