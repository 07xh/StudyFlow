# StudyFlow Windows 打包与真实数据验收

## 兼容性原则
- 旧仓库、旧 EXE、原版 WPF 界面和 Python 模块 **不覆盖、不删除**。
- 知到使用学序内置 ZHS 0.1.5 与只读课程 CLI，登录及扫码不再依赖旧 ZHSDesktop 安装目录。若安装了原版，其文件和账号数据必须保留不变。
- 雨课堂从当前用户提供的 Session ID、CSRF Token、课堂 ID、学校 ID 查询官方接口。新凭据存入 Windows Credential Manager，不写入源码和原版 .env。
- 新 UI 只读同步实际课程与视频元数据。没有服务器确认的进度显示为“暂无服务端确认数据”。

## 本地 Windows 11 构建
需要 Python 3.13、Node.js 22、Rust stable、Visual Studio C++ Build Tools 和 WebView2。执行：

\`\`\`powershell
powershell -NoProfile -File .\scripts\build-windows.ps1
\`\`\`

脚本依次安装依赖、运行 Python 测试、构建 React、使用 PyInstaller 编译 sidecar、生成本项目原创图标，再使用 Tauri 2 打包 NSIS 安装程序。

输出目录：\`src-tauri/target/release/bundle/nsis/\`

## GitHub Actions 节省时间
- `workflow_dispatch` 可手动启动完整 Windows 打包；涉及打包的主分支提交亦可触发构建。
- Python 回归默认仅在 Pull Request 或手动执行，减少 Windows Runner 时间占用。
- 只有工作流实际成功且上传 artifact 后，才能称为“Windows EXE 构建成功”。

## 真实验收清单
1. 在**仅安装学序**的全新 Windows 用户环境中完成知到扫码登录；检测连接必须基于真实 `doctor-server` 服务器结果，不以 Cookie 文件存在当作登录成功。
2. 点击知到同步课程，核对 \`.zhs/zhidao-courses.json\` 的同会话 HMAC，确认不是旧账号数据。
3. 雨课堂输入自己的当前有效会话后保存，确认能获得课堂名和章节视频；错误会话必须不显示已连接。
4. 从界面同步课程、关闭重开软件、重复同步，确认原版程序仍能独立运行。
5. 安装和卸载新程序后确认原版 ZHSDesktop 和雨课堂文件不受影响。

## 当前尚未实测的事项
Windows 的冻结运行时与 NSIS 产物由 CI 检查，官方账号扫码及课程读取仍需在用户电脑上实际验证；离线 CI 不等于官方服务器认证成功。

## 最后接入检查（2026-11-14）

冻结后的 sidecar 增加 `--yuketang-env-check`，在临时目录中导入原版 main.py（不调用 main、不访问网络），验证 runpy 脚本依赖和原版配置入口均已打包。`--zhidao-env-check` 同时导入 CLI、课程、扫码和单课核验入口。两者失败均阻止 NSIS 打包。

知到官方播放器参数保存到 `%LOCALAPPDATA%/StudyFlow/zhidao/official-player-settings.json`。初次读取可兼容旧 ZHSDesktop 设置，保存时不会写回旧安装目录。
