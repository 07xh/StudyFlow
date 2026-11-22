# StudyFlow 共享题库服务：Windows EXE 本地调用

从 rc.58 开始，**言溪只是第一个题库来源**，题库统一由
`studyflow.services.question_bank` 管理，供任意课程练习/作业 UI 复用。

## 使用方式

- 「设置 → 题库与搜题」：选择题库，保存多条带备注的 Token，显式选择默认 Token，删除不需要的 Token，手动查询。
- 「知到 → AI 掌握度 → 单道练习题」：每道题下方有「题库查题」，展开后选择题库/Token，再点击「查询这道题」。
- 将来普通知到作业、雨课堂习题、学习通作业有真实题目 UI 时，可以复用组件，不再单独编写言溪前端：
  `<QuestionBankQuestionAction desktop={desktop} question={normalizedQuestion}/>`。
- 后端 IPC：`questionbank.providers` / `questionbank.tokens.list` /
  `questionbank.tokens.add` / `questionbank.tokens.select` /
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

## 多 Token 与存储

- 采用 Windows 用户级 DPAPI 加密整个保险库：
  `%LOCALAPPDATA%\StudyFlow\question-bank\providers.dpapi`。
- 每个提供方最多 20 条 Token；Token 有独立 UUID 和可读备注。
  默认 Token 仅用于用户**显式发起**的查询；也可以按题指定另一条 Token。
- 首次读取自动迁移 rc.57 的 `yanxi.dpapi`。
  先加密写入新保险库，确认成功后再删除旧文件。
- 查询失败时不会自动轮换 Token、批量试探额度或重复发送请求。
- 列表 API 只返回提供方、Token ID、备注和默认状态，永不回显明文 Token。
- 题目/答案不写入保险库；没有云端同步，也不需要 Cloudflare。
- 此 Windows 用户身份下运行的其他本地进程仍可能访问用户级 DPAPI 数据；不是防恶意程序隔离技术。

## 扩展其他题库

在 `question_bank.PROVIDERS` 注册另一个固定提供方的
`name`、`description`、`lookup(title,options,type,token=...)` 适配器。
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
