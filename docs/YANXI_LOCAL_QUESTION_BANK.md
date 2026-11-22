# 言溪题库：Windows 本地直连（可选）

学序 Windows EXE 的原生界面有两个入口：

- 「全局设置 → 题库与搜题」：配置 Token、输入题目、主动查询。
- 「知到 → AI 掌握度 → 言溪题库」：选择当前**练习**试卷中的题干与选项，一次查询一题。

**架构**：Tauri/React → 现有 JSONL IPC → 打包的 Python Sidecar → `https://tk.enncy.cn/query`。
不需要 Cloudflare、额外进程、独立窗口或另行安装 Python。

## Token 与隐私

- 请使用自己的合法 Token。Windows 本地采用用户级 DPAPI 加密保存，
  路径为 `%LOCALAPPDATA%\StudyFlow\question-bank\yanxi.dpapi`。
- 状态接口仅返回 `configured`，不会把 Token 明文返给前端。
- 查询为用户主动发起；目前仅支持单题查询，不会遍历题库、批量调用或自动提交。
- 题干、选项、题型及 Token 会传给言溪。知到 Cookie、账号、课程 ID、答题卡不传给言溪。
- 公开适配器使用 GET 查询，因此 Token 位于到言溪的 HTTPS 请求 URL 中；
  本地不会记录 URL，也禁止跟随重定向。此风险取决于言溪服务端日志制度。
- 若使用同一 Windows 用户账号，能运行该用户进程的软件也可能使用用户级凭据。
  DPAPI 不是针对本机恶意程序的绝对隔离。

## 查询行为与边界

- 查询采用 `title` / `options` / `type` 参数。返回 `data.answer` 与可选 `data.times`。
- 只有响应包含非空答案且通过基础错误检测时才显示「匹配」，否则显示「未命中」或明确错误。
  公开实现存在 `code` 为 0/1 的差异；单靠状态码不判定正确。
- 言溪搜索结果是**第三方参考答案**。它与已存在的本地 SQLite 官方判分答案库相互隔离，
  不写入 `AnswerBank.confirm`，不会当作「官方已验证」成绩，也不会自动保存/提交到知到。
- 「查询参考答案 / 验证连接」是一次真实 API 搜索，可能消耗剩余额度。
  仅保存 Token 或打开设置不会查询言溪。
- 需要自行在有效 Token 的电脑上验证第三方服务的实时响应。
  这份实现的离线测试使用模拟 HTTP 与模拟 DPAPI，不声称已通过真实账号验收。

## 开发与检查

`pytest -q tests/test_yanxi_question_bank.py`

`npm --prefix frontend test`

`npm --prefix frontend run build`

受 Windows DPAPI 约束，本地 Token 存储只能在 Windows EXE 内实际使用。
