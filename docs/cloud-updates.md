# 学序云端更新 A+B

- 设置 → 版本与更新：查询 GitHub Releases，显示真实版本与更新日志。
- A（仅提示）：启动后检查，用户选择是否下载。
- B（默认）：启动后检查并在后台下载，通过 GitHub Release asset 的 SHA-256 digest 校验后保存在学序更新目录。
- 稳定通道查询 latest；Beta 通道查询预发布列表。无 Release 时显示暂无已发布更新；网络错误单独提示。
- 偏好保存在 `%LOCALAPPDATA%/StudyFlow/updates/preferences.json`；安装包也只写入该更新目录。凭据和课程数据不在更新目录内。
- 不接受前端传入下载地址、哈希或磁盘路径。后端重新查询本仓库发布资产，只接受唯一且带 SHA-256 digest 的 Windows x64 EXE。
- 下载完成提供“打开更新目录”；关闭学序后由用户运行 NSIS 安装程序。本轮没有实现自动退出安装、失败回滚或发布签名，因此不称为一键自动安装。
- GitHub Actions 验证并生成 Windows NSIS artifact；artifact 和 Release 是不同渠道，未发布的 CI 包不会被更新检查误认为正式 Release。
