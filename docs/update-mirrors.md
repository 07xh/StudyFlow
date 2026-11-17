# 学序下载加速：两个公共 GitHub 代理 + 官方回退

## 零配置方案
不使用 R2、SourceForge、对象存储、自建服务或中国内地 CDN；无需用户注册、备案或上传安装包。
- 官方权威：GitHub Releases API 获取已发布版本、更新日志和 SHA-256 `digest`。
- 安装包下载代理：`https://gh-proxy.com/`、`https://ghfast.top/`，只在**公开 GitHub Release 安装包**地址前增加代理前缀。
- 默认自动模式：`gh-proxy.com` → `ghfast.top` → GitHub 官方资产地址；用户可只用 GitHub，也可选“公共代理”优先。
- 每一个下载来源均使用同一个从 GitHub 获取的 SHA-256 校验，不信任代理提供的元数据或哈希。

## 具体下载映射
官方地址格式：
`https://github.com/07xh/StudyFlow/releases/download/<tag>/<asset>.exe`

代理地址格式：
`https://gh-proxy.com/https://github.com/07xh/StudyFlow/releases/download/<tag>/<asset>.exe`
`https://ghfast.top/https://github.com/07xh/StudyFlow/releases/download/<tag>/<asset>.exe`

地址必须匹配本仓库公开 Release 文件，拒绝外部任意 URL、查询参数、认证 Cookie 和 Token。只允许预设 HTTPS 代理域名及 GitHub 的已知文件 CDN 重定向域名。

## 下载安全与恢复
- 网络失败允许按优先级切换下一个来源；下载片段以官方 SHA-256 区分，使用 HTTP Range 续传。
- 服务器不支持 Range（返回 200）则覆写旧片段；返回有效 206 且 Content-Range 匹配才允许追加。
- 文件完整计算 SHA-256 以后才会重命名为正式 EXE；错误页面、损坏下载不会作为安装包展示，也不会自动执行。
- 从公共代理下载公开安装包时，对方会看到请求中的文件 URL 及网络来源地址；禁止经公共代理传输登录会话、私人文件、API Token。
- 公共代理随时可能关闭、限速或变更行为，所以没有速度保证；GitHub 官方下载仍保留，并且镜像失败可能增加等待时间。

## 功能边界
- GitHub API 是唯一更新检查入口：GitHub API 无法访问时，当前不会借公共代理绕过官方版本校验。
- 无需国内 CDN 或 ICP 备案；这不是自有国内 CDN 服务。
- 新版暂不支持实时下载百分比或自动运行安装包，用户关闭学序后手动安装。
- 发布前验收 Python、React 和 Windows NSIS 构建；真实国内网络上的下载速度与回退仍需真机验证。
