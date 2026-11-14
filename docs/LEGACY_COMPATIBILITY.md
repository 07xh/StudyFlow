# 保留原功能的迁移策略

**不覆盖、不删除、不重命名** 知到与雨课堂原仓库、原安装目录或原 GUI。

- 知到：新增 `legacy_runtime.py` 适配器，通过独立子进程调用原有 `doctor-server` 和 `courses` 命令，沿用原运行时、会话、网络协议和缓存逻辑；未修改旧代码。仅同步成功、缓存格式正确且与当前 cookie HMAC 匹配时读取课程。
- 注意：本适配器的安装路径是假定的旧版默认目录，需要在 Windows 真机核实；未安装时明确报错。
- 雨课堂：原 `main.py` 保持不变；后续只读查询模块独立提取，不能直接 import 触发全局 stdout 重定向。
- UI：新 React UI 与旧 WPF GUI 并行保留，逐项验收后再决定默认入口。
- IPC：Python JSON Lines 服务已实现；Tauri Rust 进程管理、sidecar 构建和安装程序尚未完成。
- 保留功能不等于在新 UI 中已经全部接通。每项功能应记录原入口、适配入口和 Windows 实机结果。
