# 学序更新下载：GitHub 官方源 + 可选 HTTPS 镜像（不使用 R2）

此功能**无需 Cloudflare R2、对象存储账号或额外云服务**。默认只使用 GitHub Releases 下载，保留下载片段及 SHA-256 校验。只有未来确实存在由维护者审核的公开 HTTPS 镜像时，才会启用额外下载源。

## 默认运行
- GitHub Releases API 提供版本、更新日志及官方发布安装包的 SHA-256；不从镜像获取版本清单。
- GitHub Release 正式安装包优先直连；网络失败保留 .part，后续发起下载时使用 HTTP Range 续传。服务器不支持 Range 时从头下载。
- 已下载完整安装包复用前仍重新计算 SHA-256；未经校验的内容不会执行或作为完整文件展示。
- 不需要 GitHub 账号、Cloudflare 账号、下载源密钥或自建服务器。更新后的安装程序仍由用户自行运行。

## 可选自备镜像（默认禁用）
- 如未来有**可信、已实际同步**的公开 HTTPS 下载站点，构建时可设置 GitHub 仓库变量 `STUDYFLOW_MIRROR_BASE_URL`，例如 `https://download.example.org`。仅支持 origin，不允许用户在 IPC 内任意提交 URL。
- 构建工具 `scripts/embed-update-mirror.py` 将地址嵌入 sidecar；没有变量时镜像功能自动禁用，GitHub 官方下载工作不受影响。
- 镜像只映射 `releases/<tag>/<filename>` 的安装包文件，必须与官方 Release asset 具有完全相同的 SHA-256。**没有自动上传镜像的工作流，也没有 R2 凭据要求**。镜像站点/同步操作要由其提供者独立完成。
- 设置中的 `自动` 在已配置可信镜像时优先尝试镜像，可开启失败切换回 GitHub；未配置时只使用官方源。用户可强制选择 GitHub 官方源。
- 公共下载镜像可能获知下载者网络地址，因此不要通过镜像发送任何学习平台 Cookie、账号信息或私人数据。

## 验证边界
- Python 离线回归覆盖镜像白名单、损坏片段、HTTP 206 续传、服务器忽略 Range、SHA-256 不一致、失败回退和旧设置迁移。
- Windows 打包测试、真实网络下载与 GitHub Releases 自动发布应分别验收；通过离线测试不能证明未配置的镜像可用。
- 当前版本尚未添加实时下载百分比和自动执行安装器；版本发现仍需要 GitHub API。
