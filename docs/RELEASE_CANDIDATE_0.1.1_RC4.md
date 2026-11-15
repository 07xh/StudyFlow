# 学序 StudyFlow 0.1.1-rc.4 · 知到 ZHS 参数 IPC 修复

此版本修复 rc.3「启动原版任务」按钮无法点击，且页面误报 Windows IPC / Python sidecar 不可用的问题。

## 已确认原因
- 前端 ZHS 参数界面调用 `zhidao.zhs.settings.get` 与 `zhidao.zhs.settings.save`。
- Python sidecar 已实现两个操作，但 Tauri Rust 的 `validate()` 白名单没有允许它们。
- 原生层因此返回 `Operation not permitted`，前端错误映射将它错误归类为 `BRIDGE_NOT_READY`；ZHS 参数也因此一直不能加载，原版任务按钮被禁用。

## 修复内容
- 精确放行上述两个设置操作；可选 `course_key` 必须符合 64 位小写十六进制要求，保存操作仍需 `settings` 对象。
- IPC 错误映射区分原生操作拒绝与真正的 sidecar 缺失或启动失败。
- 禁用的原版任务按钮不再保持绿色可运行样式，而是标示具体拦截原因；保留原有会话、课程、参数和任务互斥保护。
- 新增 Rust 白名单与前端按钮状态回归测试，保留课程与服务器进度的证据边界。

## 安装与验收
- 请从正式 Release 下载 `StudyFlow_0.1.1-rc.4_x64-setup.exe` 并覆盖安装，不必卸载或删除旧本地数据。
- CI 应通过 Python、React/IPC、浏览器布局、Rust 测试及 Windows NSIS 安装/升级/卸载测试。
- 真实 Windows 电脑上需再次验证：课程详情 → ZHS 原版 → 展开「ZHS 原版 · 观看控制」；应成功读取本机参数，且不再提示与此接口对应的 IPC 服务不可用。
- 通过 CI 不等于在用户账号上验证所有真实任务及进度记录。
