# StudyFlow Windows 打包与真实数据验收

## 兼容性原则
- 旧仓库、旧 EXE、原版 WPF 界面和 Python 模块 **不覆盖、不删除**。
- 知到使用既有 ZHSDesktop 安装目录和原扫码登录脚本；该原程序仍需另行安装。学序安装程序不会卸载它。
- 雨课堂从当前用户提供的 Session ID、CSRF Token、课堂 ID、学校 ID 查询官方接口。新凭据存入 Windows Credential Manager，不写入源码和原版 .env。
- 新 UI 只读同步实际课程与视频元数据。没有服务器确认的进度显示为“暂无服务端确认数据”。

## 本地 Windows 11 构建
需要 Python 3.11、Node.js 22、Rust stable、Visual Studio C++ Build Tools 和 WebView2。执行：

\`\`\`powershell
powershell -NoProfile -File .\scripts\build-windows.ps1
\`\`\`

脚本依次安装依赖、运行 Python 测试、构建 React、使用 PyInstaller 编译 sidecar、生成本项目原创图标，再使用 Tauri 2 打包 NSIS 安装程序。

输出目录：\`src-tauri/target/release/bundle/nsis/\`

## GitHub Actions 节省时间
- 仅 \`workflow_dispatch\` 手动执行完整 Windows 打包，不随每次 push 触发。
- Python 回归默认仅在 Pull Request 或手动执行，减少 Windows Runner 时间占用。
- 只有工作流实际成功且上传 artifact 后，才能称为“Windows EXE 构建成功”。

## 真实验收清单
1. 运行原知到扫码登录，学序点击“检测连接”必须根据原版 doctor-server 的服务端结果显示状态。
2. 点击知到同步课程，核对 \`.zhs/zhidao-courses.json\` 的同会话 HMAC，确认不是旧账号数据。
3. 雨课堂输入自己的当前有效会话后保存，确认能获得课堂名和章节视频；错误会话必须不显示已连接。
4. 从界面同步课程、关闭重开软件、重复同步，确认原版程序仍能独立运行。
5. 安装和卸载新程序后确认原版 ZHSDesktop 和雨课堂文件不受影响。

## 当前尚未实测的事项
Windows 实机的旧版安装路径、ZHS 依赖、Tauri Rust 构建、官方接口实际结构和 NSIS 产物，都需通过上述验收。任何离线单测均不能替代。
