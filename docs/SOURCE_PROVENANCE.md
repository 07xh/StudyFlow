# 源码来源与迁移记录

## 知到
- 上游仓库：`07xh/zhidao-assistant`。
- 原始任务启动器、监控/播放器资源和只读 CLI 文件快照位于 `legacy/zhidao/`。
- 来源版本：`53c92446d40b2cd1732c9aa1884d9f3b3a3fe55a`；文件字节与来源 blob SHA 由 `docs/ORIGINAL_SOURCE_MANIFEST.json` 和 `tests/test_original_playback.py` 持续核验。
- `src/studyflow/platforms/zhidao/` 中的课程、诊断、二维码和缓存适配器保留独立模块边界；正式发布仍需检查全部依赖许可证。

## 雨课堂
- 上游仓库：`07xh/yuketang-heartbeat`。
- 来源版本：`a81cf336d7f2d635d7500b5d6698e251e88c5a73`。
- 原始 `main.py`、恢复版 `exe_entry.py` 和 `requirements.txt` 已快照至 `legacy/yuketang/`，文件 SHA 由 `docs/ORIGINAL_SOURCE_MANIFEST.json` 锁定。
- 原始 `main.py` 由隔离的 StudyFlow 子进程执行，不直接导入 GUI/IPC 主进程。只读课程元数据适配器与原版任务执行器分离。
- `exe_entry.py` 属于恢复版入口；原 EXE 字节码未完全恢复，不宣称全部历史菜单和功能均已找回。
- 上游仓库对第三方材料权利和再分发许可的说明仍需遵守；未经确认的代码不应继续公开复制或打包。

## UI 与第三方许可
- 用户提供的 `LightC-UI-源码-2.18.3.zip` 已重新读取，SHA-256：`f853a16e890ab8f082e62c33dd360b1cf396a41f8c904f7f85919fd7d4836624`。
- 根目录许可证为 **LightC Source Available License v1.0**，允许个人教育/研究和非商业修改，但限制未经书面许可分发修改版、编译包及将其作为独立产品或替代产品发布。
- StudyFlow 公开仓库和安装程序不复制该项目的源码、组件、资源或衍生实现。侧栏、主题、开关和空状态由 StudyFlow 自有 React/TypeScript/CSS 独立实现。
- 详细审查见 `docs/LIGHTC_UI_REVIEW.md` 和 `docs/LICENSE_PROVENANCE.md`。

## 验收规则
- 不使用模拟课程数据宣称真实平台可用。
- 原始快照与上游来源 SHA 必须持续一致；有意修改须单独记录并审查。
- 登录凭据、Cookie、HAR 与本地缓存不得提交。
- CI、离线测试和 Windows 打包不能替代真实账号与真实课程端到端验收。
