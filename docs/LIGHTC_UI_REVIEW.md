# LightC-UI 2.18.3 源码审查与迁移边界

## 已读取的用户提供压缩包
- 文件：`LightC-UI-源码-2.18.3.zip`
- 316 个 ZIP 条目，解压前文件总大小约 6.9 MB。
- `package.json`：React 19、TypeScript 5.8、Vite 7、Tailwind CSS 4、Framer Motion 12、Tauri 2。
- `src/App.tsx`：侧边栏、仪表盘、设置弹窗等页面结构。
- `src-tauri/Cargo.toml`：Rust/Tauri Windows 桌面后端。

## 许可证门禁（关键）
- 源码根目录 `LICENSE` 为 **LightC Source Available License v1.0**，不是 OSI 开源许可。
- 条款允许个人非商业研究与修改，但限制分发修改版本、编译包以及作为独立产品重新发布。
- 因此 **不要把 LightC 原始组件、资源或其派生代码提交到 StudyFlow 公开仓库**，也不要在未获许可的情况下将其打包发布为 StudyFlow.exe。
- 可将其作为本地研究参考，独立开发 StudyFlow 自有 React/Tauri 组件；如需复制组件或分发修改版，先取得权利人书面许可。

## 推荐的 StudyFlow 工程调整
```
frontend/                 # 自主实现 React + TypeScript UI
  src/components/
  src/pages/
  src/styles/
src-tauri/                 # 自有 Tauri 2 桌面壳及 IPC
src/studyflow/            # 现有 Python 业务模块
  platforms/zhidao/
  platforms/yuketang/
  core/
  services/
  storage/
packaging/                # Windows 打包、Sidecar 配置
```

## 实施阶段
1. 独立实现首页、侧栏、课程卡片、登录弹窗和深色主题，禁止复制 LightC 受限代码。
2. 保留原知到 PowerShell/WPF UI 作为功能契约参考，不作为最终主窗口。
3. 雨课堂 `main.py` 在导入时会重定向 stdout/stderr 和创建日志，先隔离副作用，再接入统一接口。
4. 建立 Tauri IPC 与 Python sidecar 的只读课程接口，保持各平台凭据隔离。
5. Windows 真机测试、许可证审查通过后再发布 EXE。

当前状态：**已审查源码和许可证，尚未移植 LightC 组件，尚未完成双平台运行时集成。**
