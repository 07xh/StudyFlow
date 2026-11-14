# 学序 · StudyFlow

Windows 多平台学习助手。统一 UI、课程列表与任务管理，平台登录及业务模块保持隔离。

> 状态：开发集成阶段。知到二维码登录核心已迁入，并接入独立持久化的 Tauri→Python QR IPC；React 扫码交互尚未完成，实际账号扫码未验收，不能宣称学序已可直接扫码登录。

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

来源：`07xh/zhidao-assistant` 的 `payload/ZHS-QRLogin.py`，固定版本 `31831684dd63191676c13e1d9a33df81ed78378b`。原仓库保持不变。

- `platforms/zhidao/qr_login_core.py`：保留 ZHS 0.1.5 原版扫码轮询、CAS 认证核验、Cookie 原子保存、扫码后立即删除 PNG 和退出清理。
- `platforms/zhidao/qr_runtime.py`：仅启动本机已有知到运行时中的 Python，提供 `start/status/cancel`，短期二维码 PNG 只在本次登录、尚未扫码阶段通过 `image_png_base64` 交给本地 UI。不要记录或持久化该字段。
- `services/bridge.py`：新增 `zhidao.qr.start`、`zhidao.qr.status`、`zhidao.qr.cancel` IPC；失败只返回固定脱敏错误码。
- `src-tauri/src/lib.rs`：二维码三种请求使用专用常驻 Python bridge，确保跨 UI 调用共享同一登录任务；课程读取等原有请求继续使用现有单次子进程模式。
- `frontend/src/bridge.ts`：新增二维码状态和命令的类型化接口。React 页面尚未接入扫码按钮和二维码窗口。

当前仍依赖旧知到安装目录中的 ZHS Python 环境；学序安装器未独立打包这套依赖。CI 只覆盖离线逻辑和构建，Windows 真机扫码认证、刷新、取消和退出清理仍需验收。
