# 学序 StudyFlow 0.1.1-rc.35｜GitHub 断点续传与免费 SourceForge 镜像

## 本版更新
- 默认使用 **GitHub Releases** 更新，完全不依赖 R2 或收费国内 CDN。
- 支持 SHA-256 校验后的断点续传：HTTP Range、未完整返回的片段保留、Range 被忽略时安全重试。
- 接入可选 SourceForge 开源文件分发：项目所有者先创建 SourceForge 项目并同步安装包，构建时配置项目 slug 后才显示为可选源。未配置时仍正常使用 GitHub。
- 保留现有更新通道、自动下载/仅提示模式和手动安装，不修改 rc.34 的学习业务模块。

## 限制和验收
- GitHub API 仍是更新版本信息唯一权威来源。SourceForge 全球镜像网络不保证中国内地速度；真实效果需要 Windows 下载验收。
- 不会自动创建 SourceForge 项目，当前也没有自动上传到 SourceForge 的流水线；每次正式发布需手动同步。
- 本版尚未实现实时下载百分比和静默自动安装。
- 仅在前端、Python、Windows NSIS CI 通过并成功合并发布后视为正式版本。

版本：`0.1.1-rc.35`。
