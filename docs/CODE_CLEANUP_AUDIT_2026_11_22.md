# StudyFlow 旧代码清理审查（2026-11-22）

基线：`main` 的 rc.62 整合提交 `aa34c801`，后续修改均置于独立清理分支，不覆盖已发布版本。

## 已核实且已整合的清理

- PR #214 整合了旧 `questionbank.yanxi.status/save/clear/query` IPC 的删除、共享题库中心重构，以及 `integration/frontend/XuexitongHeartbeatPanel.{tsx,css}` 两份重复副本的清理。
- 正式运行组件位于 `frontend/src/components/XuexitongHeartbeatPanel.{tsx,css}`；删除的是历史镜像，不是运行中的学习通组件。
- 旧 `yanxi.dpapi` 仍有一次性只读迁移入口 `yanxi._load_legacy_token()`，由 `question_bank._read()` 调用：先写入新加密保险库，再尝试移除旧文件。
- `questionbank.tokens.add` 仍是共享 IPC 兼容入口，不应因前端改用批量导入而删除服务端处理器。

## 本轮发现与修改

| 审查点 | 证据 | 处理 |
| --- | --- | --- |
| 通用题目校验依赖首个题库的专用工具 | `question_bank._question_field()` 调用 `yanxi._field()` | 改为独立的通用题干、题型和选项校验；保留已有字段边界 |
| 外部诊断原因可能含原始网络/凭据信息 | `check_token()` 直接截取任意 `report["reason"]` | 只允许内部约定的状态原因码；`_public()` 对已存旧元数据也做过滤 |
| 新增题库的通用 Token 格式错误提示缺失 | 前端仅映射言溪专属 Token 错误 | 增加 `QUESTIONBANK_INVALID_TOKEN` 文案，不反显 Token |
| README 仍标注 U校园 PR #151 为 Draft | PR #151 实际已合并 | 改为「代码已合并、真实账号待验」，不夸大功能 |
| 题库接入文档仍说清理只存在于 rc.61 之外的分支 | 代码已由 PR #214 合入 rc.62 | 更正版本说明，避免误读当前安装包状态 |

## 确认保留，不按旧文件名删除

- `legacy/zhidao/`：官方播放器脚本、许可证/源码出处、安装与旧配置兼容使用这些资源；具体删除前需逐文件检查打包路径和运行时调用链。
- `legacy/yuketang/`：原版 `main.py`、`exe_entry.py` 等用于独立运行时及参数兼容，不能当作纯废弃目录。
- `src-tauri/src/legacy_tasks.rs`、`src/studyflow/services/legacy_playback.py`、前端 `LegacyPlaybackPanel.tsx`：仍有原版任务管理用途；不能按 `legacy` 名称清理。
- `docs/RELEASE_CANDIDATE_*.md`：历史发布记录应保留，以便追溯变更与版本包。
- 旧 DPAPI 解密/迁移入口：即使新 UI 已不暴露旧操作，也须为从旧版本直接升级的用户保留。

## 待审查而未删除

- 各平台只读适配器和历史恢复模块：需要针对真实导入、构建脚本、测试入口及运行时引用逐项核对。
- 通用保险库目前仍借用言溪适配器的 DPAPI 加解密函数。独立加密模块可作为后续重构，但必须先确认旧凭据迁移和 Windows 测试可覆盖，不能在本次小型清理中贸然改动。
- 题库 Token 剩余额度来自最近一次接口响应，未被证实实时准确；清理不得误改成可靠的实时余额或自动重试。

## 验收边界

本轮只清理耦合、过时说明和 IPC 状态信息。Python 单元测试、React UI/IPC 测试及 Windows 构建检查通过，不等于第三方 Token/学业进度的真实在线验收。
