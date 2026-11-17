# 学序安装包镜像（GitHub Releases + Cloudflare R2）

## 信任边界
- GitHub Releases API 是唯一更新版本与 SHA-256 digest 来源。R2 是**字节镜像**，不能决定发布版本或校验值。
- 源地址从打包时的仓库变量嵌入 sidecar；前端不能提交 URL、目标目录或 SHA-256。
- 优先镜像失败后可回退到 GitHub；所有安装包均必须通过 GitHub digest 校验，才从 .part 原子替换为最终 EXE。**不会自动执行安装包**。
- 此版本仍依赖 GitHub API 做发布发现；GitHub API 故障不会凭未经签名的 CDN 清单选择新版本。若未来增加离线镜像清单，需要先实现签名认证。

## Cloudflare R2 部署配置
1. 创建一个仅用于公开发布安装包的 R2 存储桶，例如 `studyflow-releases`，配置公开 HTTPS 自定义域名（或 R2 开发子域名）。不要将账号 Cookie、课程数据上传到存储桶。
2. GitHub 仓库 **Variables**：`STUDYFLOW_R2_PUBLIC_BASE_URL` = `https://download.example.org`（仅 origin，不带路径）。
3. GitHub 仓库 **Secrets**：`STUDYFLOW_R2_ACCOUNT_ID`、`STUDYFLOW_R2_ACCESS_KEY_ID`、`STUDYFLOW_R2_SECRET_ACCESS_KEY`、`STUDYFLOW_R2_BUCKET`。授予仅对发布桶写入所需权限，客户端不持有任何 R2 密钥。
4. 主分支构建前 `scripts/embed-update-mirror.py` 将公开镜像 origin 写入 Python sidecar；发布候选版成功后，CI 同步本次已经验证的 NSIS EXE 到 `releases/<tag>/<asset-filename>`。如存储桶/密钥未配置，镜像同步跳过，GitHub Releases 更新仍然工作。
5. 首次启用后，检查公开镜像 HEAD/GET 可访问、文件 SHA-256 与 GitHub Release digest 一致，进行实际 Windows 下载/断线续传/回退验收，再宣称生产镜像可用。

## 下载规则
- `自动`：存在已配置 R2 时优先 R2，否则 GitHub；不做不可靠的带宽测速。
- `GitHub` / `R2`：优先选定源，允许用户关闭跨源故障切换。
- 仅对 HTTP 206 且 Content-Range 起点匹配的响应续传；如果服务器忽略 Range 返回 200，则丢弃旧片段从头写入。
- 网络故障保留以 SHA-256 标识的 .part；校验失败或不可信重定向会删除片段，不会把它当成安装包。
- 当前下载期间界面提示处理中，尚未提供实时下载字节进度；安装动作仍由用户手动完成。

## 限制
GitHub Actions artifact 不等于 GitHub Release；本方案只同步发布成功、通过版本校验的 release installer。CI、上传完成以及配置凭据不等于用户网络已真实验收。
