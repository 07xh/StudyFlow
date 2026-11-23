# 学序 StudyFlow · React 桌面前端

本目录是 **StudyFlow Windows 客户端的实际前端**（React、TypeScript、Vite、Tauri 2），不是未接线的 UI 原型。四个平台为 **知到、长江雨课堂、学习通、U校园**。原版运行器、会话、数据核验与持久化由 Rust／随安装包分发的 Python sidecar 负责；前端不代替这些模块模拟服务器学习记录。

## 本地开发与测试

在仓库根目录安装 Tauri CLI 依赖、在前端目录安装依赖后，可分别执行：

```bash
cd frontend
npm install
npm run dev
npm run build
npm test
```

浏览器 Vite 预览不具备 Tauri 后端及本机账号会话；预览状态不代表四平台真实连接正常。桌面整合构建和 Windows NSIS 安装包验收统一以根目录 `scripts/build-windows.ps1` 和 GitHub Actions 为准。

## 当前模块

- `src/App.tsx` 与 `src/ui/AppShell.tsx`：统一导航、课程详情、任务、设置、记录及日志；四平台共享状态，不使用伪造课程作为登录成功的证据。
- `src/bridge.ts`：Tauri IPC、JSONL Python sidecar 请求类型、响应校验和安全错误提示；不在前端持久化 Cookie／Token。
- `src/components/ZhidaoAccountTools.tsx`、`src/ZhidaoQrDialog.tsx`：知到扫码、Cookie 导入及登录诊断入口，真实功能以桌面环境与原版运行时的验证为准。
- `src/components/YuketangTaskArea.tsx`、`src/components/XuexitongHeartbeatPanel.tsx`：对应平台的设置、任务和状态展示。
- `src/components/UCampusProgressVerifyPanel.tsx`：U校园服务器只读进度核验；独立实验模块不属于已经验证的官方进度同步。
- `src/presentation.ts`：区分未核验、历史缓存、服务器已核验的课程进度证据；不将本地运行状态推断为服务器完成。
- `src/ui/foundation.css` 与平台组件样式：当前桌面界面样式基线，清理前需检查运行中组件的选择器引用。

## 功能与验收边界

CI 的 Python 回归、React 生产构建/UI 测试和 Windows NSIS 打包验证的是**代码与安装包**，并不代表所有平台账号、学校接口或服务器进度已完成在线端到端验收。历史兼容配置和原版知到、雨课堂运行器仍由独立模块维护，不能仅因文件名包含 `legacy` 而删除。

完整功能、原项目授权、构建步骤及当前接入边界见 [根目录 README](../README.md)、[Windows 构建说明](../docs/BUILD_WINDOWS.md)。
