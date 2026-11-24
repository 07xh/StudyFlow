# 学序 StudyFlow v0.1.1-rc.67｜旧代码清理、构建稳定性与 Windows 升级验证

## 版本定位
本次版本集中合并 PR #247 的多轮清理与构建质量改进，基于 rc.66 继续维护现有四平台架构。**没有重写知到或雨课堂原版播放器、心跳协议和服务器学习进度读取方式。** U校园只读核验与已有实验性模块继续保持独立；不把本地事件发送等同于服务器确认完成。

## 主要更新
### 1. 清理过时代码，保留兼容能力
- 删除已退役的 U校园旧本地心跳运行器、对应服务桥接和无入口 IPC；保留可用的 U校园只读监控、Socket.IO 诊断和现有独立实验模块。
- 移除仅用于占位的 Python `studyflow.ui`、`studyflow.storage` 空目录，修正旧元数据和前端构建说明。
- 删除已被现有桌面主题覆盖的 WPF 配色、旧全局导航与重复授权弹窗 CSS，新增样式回归契约，保留有效布局与交互组件。

### 2. 凭据存储解耦和旧数据兼容
- 通用题库 DPAPI 逻辑提取至独立 `dpapi_storage.py`，采用 Windows 当前用户加密方式；保留原言溪 Token 加密文件的读取兼容与一次性迁移路径。
- 旧用户配置与独立原版 ZHSDesktop / 雨课堂源码目录不在此次清理范围内。迁移测试使用合成 Token，不会把用户真实敏感数据提交至 GitHub。

### 3. 构建、依赖与 CI
- 删除过时且未使用的 `packaging/requirements.txt`；Python 依赖统一由 `pyproject.toml` 管理，PyInstaller 保留已验证的主版本边界。
- 新增真实解析的根目录 `package-lock.json` 和 `src-tauri/Cargo.lock`，两套 npm 安装改用 `npm ci`，Rust 测试使用 `cargo test --locked`；发布前校验 Node、Cargo 和 Python 版本声明一致。
- 移除 Windows 打包中重复的 React 生产构建，继续通过 Tauri `beforeBuildCommand` 构建一次。
- 排除 PyInstaller 中仅用于开发测试的依赖，保留正式凭据后端、原版知到与雨课堂运行时；改进 npm/pip/Playwright 下载缓存与 CI 构建契约。

### 4. 安装升级与数据保留
- 使用 GitHub 官方上一版 Release 安装包及 SHA-256 校验，执行真实旧版→新版升级、同版本重装、已安装运行时探针、后台 EXE 占用阻断、正常关闭和卸载。
- 用非敏感随机标记检查 `%LOCALAPPDATA%/StudyFlow`、知到、题库、更新缓存以及原版 `ZHSDesktop` 和 `~/.zhs` 数据目录在升级卸载后未被误删。
- rc.66 的最终测试曾遇到一次 Windows 关闭超时，重跑通过；本版本继续把正常关闭与升级/卸载保持为强制 CI 门禁，不能以强制杀进程代替。

## 测试与已知边界
- 清理分支 rc.66 的最终完整 CI（GitHub Actions #45230947269，第二次运行）已通过 Python/React/Rust、Windows NSIS 构建与 rc.65 → rc.66 离线升级卸载检查。
- **rc.67 必须以本版本自己的完整 CI 为验收依据，不能直接引用上一版的通过结果。** 成功后由仓库发布工作流创建对应的 GitHub 预发行版及 NSIS 安装包。
- GitHub Actions 不含真实校园账号登录、真实服务器进度回读或真实 Windows Credential Manager 历史账户迁移。旧用户建议先备份配置，再用安装包升级，核对本机凭据与课程读取情况。
- 仍需关注 Windows 无界面环境下偶发的关闭超时；回归必须保留失败记录并复核，不能声称完全消除。

项目：`07xh/StudyFlow`　版本：`0.1.1-rc.67`。
