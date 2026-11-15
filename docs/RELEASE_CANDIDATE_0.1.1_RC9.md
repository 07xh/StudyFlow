# 学序 StudyFlow 0.1.1-rc.9

## 修复范围
- 延续 rc.8 的 Windows ZHS 原版任务用户主目录修复和 CLI 退出阶段安全分类。
- 新增原版 ZHS 0.1.5 会话预检分阶段诊断：Cookie 无法恢复、服务器判定会话过期、服务器校验暂不可用。
- Python 仅在原版 CLI 的会话预检调用期间观察返回结果，不改变源函数的网络请求、参数、返回数据、异常、进度或平台记录。
- Rust 使用固定错误代码白名单；UI 显示明确处理建议，不记录 Cookie、原始异常、课程地址或敏感日志。
- 增加 Python、Rust、React 回归测试；仍沿用完整 Windows NSIS 打包及安装/升级/卸载检查。

## 发布门禁
必须先在 GitHub Actions 上通过 Python、React、Windows Rust/NSIS 构建和安装测试，再发布正式 rc.9 预发布安装包。原版 ZHS 的服务器会话和实际视频运行需要使用本人 Windows 设备进一步验证，不能用 CI、退出码或本地进度代替服务器认可的学习记录。

此版本不修改 ZHS 的心跳算法、上报方式、验证码限制或用户的现有 Cookie。
