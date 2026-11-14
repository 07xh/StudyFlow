# 学序 · StudyFlow

Windows 多平台学习助手。统一 UI、课程列表与任务管理，平台登录及业务模块保持隔离。

> 状态：开发集成阶段。已迁入知到二维码登录核心、CAS 核验和临时二维码清理，并接入本地 JSONL IPC；React 页面仍为开发预览，尚未接通真实扫码交互或完成真机登录验收，不宣称可直接扫码登录或播放。

## 目录
- `src/studyflow/ui/`：LightC-UI 界面适配
- `src/studyflow/platforms/zhidao/`：知到适配
- `src/studyflow/platforms/yuketang/`：雨课堂适配
- `src/studyflow/core/`：统一课程数据契约
- `src/studyflow/services/`：业务编排
- `src/studyflow/storage/`：本地数据
- `tests/`：单元与集成测试
- `packaging/`：Windows 打包配置
- `docs/`：架构与迁移记录

构建源仅为本仓库。旧项目只作为迁移来源，需核对许可、依赖、凭据与真实功能后逐模块接入。

## 知到二维码登录核心迁移

迁移来源：`07xh/zhidao-assistant` 的 `payload/ZHS-QRLogin.py`，固定基线提交 `31831684dd63191676c13e1d9a33df81ed78378b`。源项目保留不修改。

- `src/studyflow/platforms/zhidao/qr_login_core.py`：沿用原 ZHS 0.1.5 扫码轮询、CAS 会话核验、Cookie 原子保存、二维码扫描后/任务结束自动删除及脱敏状态。
- `src/studyflow/platforms/zhidao/qr_runtime.py`：启动、查询、取消独立扫码子进程；只在当前扫码阶段传递短期 PNG；扫码后不再返回图片。需要本机已安装知到旧版 ZHS Python 运行时，缺少依赖会返回 `environment-error`，不会假装成功。
- `src/studyflow/services/bridge.py`：新增版本 1 的 `zhidao.qr.start`、`zhidao.qr.status`、`zhidao.qr.cancel` JSONL 操作；状态仅有固定阶段码，图片字段为临时 `image_png_base64`。**不要持久化或记录此图片**。
- `frontend/src/bridge.ts`：新增前端 IPC 类型定义；尚未把 UI 连接到实际 sidecar，也没有独立完成知到运行时打包。当前仍需旧版知到安装环境。

验证范围：离线状态机、启动失败、图片新旧隔离、Cookie 保留与 IPC 错误脱敏；实际 Windows 账号扫码、刷新与服务器认证仍需验收。不要把 CI 通过当作实际可用。
