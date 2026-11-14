# 源码来源与迁移记录

## 知到
- 上游仓库：`07xh/zhidao-assistant`
- 审查时上游 `main` 树 SHA：`157c48aa2c37da8d15137c94be3ef67afc2f6cb9`
- `payload/zhidao_courses.py` → `src/studyflow/platforms/zhidao/courses.py`：仅调整 `zhidao_diagnostics` 为包内相对导入。
- `payload/zhidao_diagnostics.py` → `src/studyflow/platforms/zhidao/diagnostics.py`：原样迁入。
- 上游包含 GPL-3.0 LICENSE；正式发布前应完成整套依赖与许可证合规审查。

## 雨课堂
- 上游仓库：`07xh/yuketang-heartbeat`
- 审查时上游 `main` 树 SHA：`a81cf336d7f2d635d7500b5d6698e251e88c5a73`
- 已确认 `main.py`、`exe_entry.py` 和 requirements；尚未迁入运行时模块。
- `exe_entry.py` 自述旧 EXE 字节码未完全反编译；不能视为全部原始功能已恢复。

## UI
- LightC-UI 2.18.3 原始 ZIP 需要重新核对实际组件和依赖后迁入，当前仓库未包含其源码。

## 验收规则
- 不使用模拟课程数据宣称真实平台可用。
- 原仓库继续保留；正式 EXE 仅从 StudyFlow 构建。
- 登录凭据、Cookie、HAR 与本地缓存不得提交。

## 2026-11-14 知到 UI 第二阶段迁移

- 审查基线更新为 `07xh/zhidao-assistant@53c92446d40b2cd1732c9aa1884d9f3b3a3fe55a`。
- 学序使用独立 React/TypeScript 组件表达动态课程卡片、登录入口、主题、响应式布局与三种服务器证据状态；**未直接复制 LightC 限制素材、原 XAML 或 PowerShell GUI**。
- 原知到实际读课由已连接的 Tauri Python sidecar 转发，沿用 HMAC 会话检查；本轮新增课程类型、stale 和去重身份字段。
- 原二维码刷新/自动清理机制仍在上游 WPF 应用；学序调用原版窗口，不声称已独立迁移其认证实现。
- 具体实现和剩余门禁参见 `docs/ZHIDAO_UI_MIGRATION.md`。
