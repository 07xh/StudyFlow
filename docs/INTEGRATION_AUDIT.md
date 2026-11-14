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

### LightC-UI
- 先前对话中的 `LightC-UI-源码-2.18.3.zip` 当前未能读取其原始内容；不得声称已复用真实 UI 组件。
- 需要重新取得 ZIP，核对框架、许可证、组件 API、资源和 Windows 打包依赖。

## 架构决策
1. `src/studyflow/ui/` 是唯一主界面，平台模块不自行创建顶层窗口。
2. `src/studyflow/platforms/{zhidao,yuketang}/` 仅放各自的登录、只读课程、正常播放与诊断适配。
3. GUI 通过显式调用适配器方法运行；不得通过导入启动网络请求、写日志或修改 `sys.stdout`。
4. Cookie、缓存和本地文件放用户数据目录，不放源码仓库或 EXE 解压目录。
5. 所有进度必须有真实平台数据来源，不能把本地估算显示成平台确认完成。
6. 源码与第三方许可核验后才启用正式打包与发布。

## 阻塞项
- LightC-UI ZIP 原始源码不可用。
- 雨课堂单体脚本的 import side effects 需要隔离。
- 知到 WPF/PowerShell 到统一 UI 的接口需要定义和回归。
- Windows 实机集成与 CI 尚未验收。
