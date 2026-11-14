# 学序 · StudyFlow

知到 + 雨课堂统一学习助手。StudyFlow 是**唯一规划中的正式 Windows EXE 构建源**；旧仓库保留原样作为兼容来源。

## 当前完成度

- ✅ React/TypeScript 统一 UI：课程卡片、知到登录交互引导、独立平台连接状态、浅/深色主题、窄窗口响应式布局。
- ✅ 只在真实 IPC 返回数据后生成课程卡片；历史缓存或没有明确服务器核验证据的值不显示成已完成进度。
- ✅ 知到 Python 只读课程适配：修复旧版安装目录定位，沿用会话指纹核验，按课程及教学班生成稳定身份。
- ✅ Python JSON Lines IPC：`ping`、`platform.status`、`courses.list`。前端协议与返回值形状验证已加入自动化测试。
- ⏳ Windows Tauri 桌面壳和受保护 IPC 注入 **尚未完成**：浏览器预览没有真实平台连接能力。
- ⏳ 新 UI 的扫码登录、Cookie 输入/导入、播放器与完整课程详情 **尚未接线**：按钮明确禁用，不收集凭据。
- ⏳ 雨课堂实际登录与课程列表调用尚未打通；已有只读章节/视频元数据模块。
- ⏳ 未构建正式 StudyFlow.exe，尚未进行 Windows 真机高 DPI、真实课程及账号端到端验收。

不提供虚构课程、伪造进度或假登录成功状态。

## 开发与测试

```bash
python -m pip install -e ".[dev]"
python -m pytest -q
cd frontend
npm install
npm run build
npm test
npm run dev
```

浏览器预览无法自动启动 Python。未来的可信 Windows 宿主必须显式注入 `window.studyflowTransport`，通过本地受保护进程管道转发 `src/studyflow/services/bridge.py` 的只读协议；不启用无鉴权 localhost 服务。

## 目录

- `frontend/src/`：唯一目标 React UI（不复制 LightC 专有资源）
- `src/studyflow/platforms/zhidao/`：知到只读课程和诊断适配
- `src/studyflow/platforms/yuketang/`：雨课堂只读元数据与待集成适配
- `src/studyflow/services/bridge.py`：本机 JSON Lines 只读 IPC
- `src/studyflow/core/`：平台及课程契约
- `tests/`：后端契约与缓存隔离测试
- `docs/`：来源、协议、许可证和迁移记录

**知到 UI 上游基线：** `07xh/zhidao-assistant@53c92446d40b2cd1732c9aa1884d9f3b3a3fe55a`。旧知到 WPF 中的 QR 刷新、登录回滚和心跳控制仍保存在上游，并不代表它们在 StudyFlow 中已经可用。
