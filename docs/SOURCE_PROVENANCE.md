# 源码来源与迁移记录

## 知到
- 上游仓库：`07xh/zhidao-assistant`
- 审查时上游 `main` 树 SHA：`157c48aa2c37da8d15137c94be3ef67afc2f6cb9`
- `payload/zhidao_courses.py` → `src/studyflow/platforms/zhidao/upstream/zhidao_courses.py`：仅调整 `zhidao_diagnostics` 为包内相对导入；`courses.py` 保留为兼容导出入口。
- `payload/zhidao_diagnostics.py` → `src/studyflow/platforms/zhidao/upstream/zhidao_diagnostics.py`：保留上游诊断实现；`diagnostics.py` 保留为兼容导出入口，与原版读取器共用异常类型。
- 上游包含 GPL-3.0 LICENSE；正式发布前应完成整套依赖与许可证合规审查。

## 雨课堂
- 上游仓库：`07xh/yuketang-heartbeat`；本次复核的上游 `main` 文件 blob：`main.py=1e64ab67376c43060e1dcdf4dfa9949b6bb27b8c`、`exe_entry.py=7a3399f3cd30d8b046225fa25940b5b835938cf8`。
- `legacy/yuketang/main.py` 与 `legacy/yuketang/exe_entry.py` 均与上游对应文件逐字节一致；`tests/test_original_playback.py` 持续锁定 Git blob SHA。
- `main.py` 由隔离的 sidecar 子进程通过 `runpy.run_path` 执行，不在 GUI/JSONL 进程中直接导入；原脚本不作改写。
- `exe_entry.py` 的 `read_cfg/save_cfg` 由 `src/studyflow/platforms/yuketang/legacy_config.py` 直接调用。主脚本读取的 12 个非凭据环境参数均映射到雨课堂二级页面，参数校验后经 Rust 子进程环境透传；凭据独立保存在 Windows Credential Manager。
- `exe_entry.py` 自述原 EXE 字节码未完全反编译。学序承接了可确认的运行、设置、启动/停止操作，但不能声称旧二进制所有未知菜单/行为均已恢复；这仍是明确的恢复边界。

## UI
- 用户提供的 `LightC-UI-源码-2.18.3.zip` 已重新取得并审查，归档 SHA-256：`bb6d3c4d48ea0d8787a29234689c32ec4a1c91d85fd03df7372e3bb3519ef3ae`。
- 其 `LICENSE` 为 LightC Source Available License v1.0：允许查看、学习及非商业研究/修改，但限制将修改版作为独立、改名产品发布，以及分发相应二进制或安装包。
- StudyFlow 是独立公开项目并生成自己的 Windows 安装包，因此没有把 LightC 的组件、资源或源码片段复制进仓库；现有浮动导航和平台 UI 为独立实现。源码级复用需先取得权利人书面许可。

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
