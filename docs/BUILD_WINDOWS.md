# StudyFlow Windows 打包与真实数据验收

## 兼容性原则
- 旧仓库、旧 EXE、原版 WPF 界面和 Python 模块 **不覆盖、不删除**。
- 学序将 ZHS 0.1.5 及知到扫码/课程只读运行时打包进自己的 Python sidecar；安装学序不再要求预装 `%LOCALAPPDATA%\\ZHSDesktop\\.venv` 或原版 WPF EXE。
- 原版知到程序及 `%USERPROFILE%\\.zhs` 登录缓存保持不动；学序扫码临时文件独立写入 `%LOCALAPPDATA%\\StudyFlow\\zhidao`。安装和卸载学序都不得清理原版数据。
- 雨课堂从当前用户提供的 Session ID、CSRF Token、课堂 ID、学校 ID 查询官方接口。新凭据存入 Windows Credential Manager，不写入源码和原版 .env。
- 新 UI 只读同步实际课程与视频元数据。没有服务器确认的进度显示为“暂无服务端确认数据”。

## 本地 Windows 11 构建
需要 **Python 3.13（ZHS 0.1.5 要求 Python >=3.13 且 <3.15）**、Node.js 22、Rust stable、Visual Studio C++ Build Tools 和 WebView2。执行：

```powershell
powershell -NoProfile -File .\\scripts\\build-windows.ps1
```

脚本会先检查 Python 版本，再安装依赖、运行 Python 测试、构建 React、使用 PyInstaller 编译独立 sidecar，并执行冻结运行时依赖导入和 JSONL IPC ping 自检，最后生成本项目原创图标并使用 Tauri 2 打包 NSIS 安装程序。

输出目录：`src-tauri/target/release/bundle/nsis/`

## GitHub Actions
- PR 检查包含 Python、React 和 Windows NSIS 独立运行时构建；Windows job 成功并上传 artifact 后才算安装包构建通过。
- main 分支中桌面源码、打包脚本或工作流相关文件变化时自动触发 Windows 打包；保留 `workflow_dispatch` 手动入口。
- Windows 构建按分支并发去重，新的同分支构建可取消旧构建，避免重复占用 Runner。
- Python 通用测试仍使用 Python 3.11；需要安装 `desktop` extra 并构建完整知到运行时的 Windows 打包必须使用 Python 3.13。

## 真实验收清单
1. 在没有原版 `ZHSDesktop\\.venv` 的干净 Windows 用户环境中安装学序，确认学序 sidecar 可独立启动；不要先删除现有原版程序或数据。
2. 运行学序知到扫码登录，点击“检测连接”必须根据服务端 doctor-server 结果显示状态。
3. 点击知到同步课程，核对 `.zhs/zhidao-courses.json` 的同会话 HMAC，确认不是旧账号数据。
4. 雨课堂输入自己的当前有效会话后保存，确认能获得课堂名和章节视频；错误会话必须不显示已连接。
5. 从界面同步课程、关闭重开软件、重复同步，确认原版程序仍可独立运行。
6. 安装和卸载学序后确认原版 ZHSDesktop 和雨课堂文件不受影响。

## 当前尚未实测的事项
CI 已验证 Python/React 测试、Windows sidecar 冻结依赖导入、JSONL IPC ping 和 NSIS 产物生成；这些不等于真实知到账号扫码、服务端课程读取或雨课堂真实会话已通过。上述真实验收仍需在用户 Windows 电脑上完成。
