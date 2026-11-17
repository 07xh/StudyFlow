# 学序下载镜像：GitHub 官方源 + SourceForge（免费、可选）

## 选型
- 默认使用 GitHub Releases 官方下载；无需 R2、收费 CDN 或自建服务器。
- 推荐 SourceForge 免费开源项目文件分发服务，官方提供全球镜像网络。
- SourceForge **不是中国内地 CDN**，在国内的实际速度要用真机实测。

## 需要项目所有者完成的首次配置
1. 在 https://sourceforge.net/create/ 创建一个公开开源项目。需要注册 SourceForge 账号并遵守其开源项目托管规则。
2. 将 GitHub Releases 里已经发布的同一份 Windows 安装包上传到 SourceForge 的 Files 下 `releases/<tag>/<filename>`。示例：`releases/v0.1.1-rc.35/StudyFlow_0.1.1-rc.35_x64-setup.exe`。
3. 先检查 SourceForge 下载到的文件 SHA-256 与 GitHub Releases 资产的 `digest` 完全一致。大文件上传可采用官方推荐的 rsync/SFTP。
4. GitHub 仓库 Actions Variables 添加 `STUDYFLOW_SOURCEFORGE_PROJECT`，值为真实 SourceForge 项目 slug（未创建前不要填写）。重新构建 Windows 安装包后，学序的下载源设置里才会启用 SourceForge。
5. 验收真实 URL：`https://sourceforge.net/projects/<slug>/files/releases/<tag>/<filename>/download`。同版本未完成上传同步时不能宣称镜像可用。

## 技术与安全约束
- **GitHub Releases API 是唯一可信的版本、更新日志和 SHA-256 来源**，不读取任意镜像更新清单。
- SourceForge 只作为安装包字节分发；只允许官方 SourceForge 入口和其 `*.dl.sourceforge.net`、`downloads.sourceforge.net` 下载跳转；所有下载结果均验证来自 GitHub 的 SHA-256。
- 下载包以校验值隔离的 `.part` 临时文件续传，Range 206 起点正确才追加，服务端忽略 Range 则从头下载；校验不一致不得标记已下载。
- 自动模式：未配置 SourceForge 时只走 GitHub；配置后优先尝试 SourceForge，失败可回退 GitHub，用户可手动强制选择 GitHub。
- 不上传登录凭据、课程、Cookie，也不静默安装下载文件。
- 当前未实现自动同步 SourceForge 安装包：每次 GitHub Release 发布后需由项目所有者上传对应文件；后续可在获得授权后另行接入 CI 上传。
- 若 GitHub API 无法访问，当前无法独立发现最新版本；配置 SourceForge 不会解决该限制。
- 此方案无需中国内地 CDN 或 ICP 备案（因为没有自行开设内地 CDN 加速域名），但应遵守 SourceForge 的服务条款。
