# 学序 UI 与平台迁移审查（2026-11-14）

## 实际上游代码

### 雨课堂
- `07xh/yuketang-heartbeat/main.py`：Python 单体程序，包含 requests、dotenv、日志输出重定向、视频相关业务和线程池。
- `exe_entry.py`：恢复版命令行入口；原 EXE 字节码未完整恢复。
- `requirements.txt`：requests、python-dotenv。
- 直接 `import main` 可能触发日志文件创建与标准输出替换，**不能**直接作为 GUI 插件导入。
- 迁移顺序：只读课程数据模型 → 登录状态读取 → 课程展示 → 正常播放入口。需避免通过非官方进度伪报实现学习记录。

### 知到
- `07xh/zhidao-assistant/payload/Zhidao-GUI.ps1`：PowerShell/WPF GUI，约 63 KB；依赖 Windows PresentationFramework、WindowsBase 等。
- `payload/Zhidao-UI.xaml`：WPF/XAML UI，约 21 KB，原版浅色主题。
- `payload/zhidao_only.py`：Python 数据读取适配器，尚需逐项审查。
- 当前 `StudyFlow` 已迁移课程身份处理与诊断两个纯 Python 模块，尚未迁移 Windows 运行时。

### LightC-UI 2.18.3
- 已从用户资料库重新取得 `LightC-UI-源码-2.18.3.zip` 并检查：316 个 ZIP 条目，解压文件总计 6,921,240 字节；归档 SHA-256：`bb6d3c4d48ea0d8787a29234689c32ec4a1c91d85fd03df7372e3bb3519ef3ae`。
- 源码基于 React 19、TypeScript、Vite、Tailwind CSS 4、Framer Motion 与 Tauri 2；已检查 `SidebarNav.tsx`、主应用布局和主题样式。
- `LICENSE` 为 LightC Source Available License v1.0。它允许查看、学习和非商业研究/修改，但限制将修改版作为独立或改名产品发布，也限制分发相应二进制、安装包或将实质性源码打包进其他产品；StudyFlow 的公开仓库和独立安装包不能仅凭“非商业”就视为获准复制。
- 因此不把 LightC 组件、资源或源码片段迁入 StudyFlow。当前浮动导航、主题和平台页面由 StudyFlow 自有 React/TypeScript 与 CSS 独立实现；只将用户要求的交互目标作为设计参考。需要直接复用源码时，先取得权利人书面许可。

## 架构决策
1. `src/studyflow/ui/` 是唯一主界面，平台模块不自行创建顶层窗口。
2. `src/studyflow/platforms/{zhidao,yuketang}/` 仅放各自的登录、只读课程、正常播放与诊断适配。
3. GUI 通过显式调用适配器方法运行；不得通过导入启动网络请求、写日志或修改 `sys.stdout`。
4. Cookie、缓存和本地文件放用户数据目录，不放源码仓库或 EXE 解压目录。
5. 所有进度必须有真实平台数据来源，不能把本地估算显示成平台确认完成。
6. 源码与第三方许可核验后才启用正式打包与发布。

## 阻塞项
- LightC-UI 源码已取得并完成许可证审查；受限源码不可直接并入 StudyFlow，独立 UI 仍需 Windows 真机验收。
- 雨课堂单体脚本的 import side effects 需要隔离。
- 知到 WPF/PowerShell 到统一 UI 的接口需要定义和回归。
- Windows 实机集成与 CI 尚未验收。
