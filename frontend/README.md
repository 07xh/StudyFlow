# 学序独立 UI

该 UI 是自主编写的 React/TypeScript 前端，借鉴常见的侧栏、卡片、渐变仪表盘等设计模式，**没有复制 LightC-UI 的源代码、资源或品牌**。

## 本地运行
```bash
cd frontend
npm install
npm run dev
```

## 当前限制
仅为独立 UI 基线；知到和雨课堂连接明确显示未接入，不使用模拟课程。下一步接入本地服务接口与桌面壳。正式 Windows EXE 尚未构建。

## 知到 UI 的新版组件（独立实现）

- `src/components/ZhidaoMigration.tsx`：课程类型和进度证据卡片、原版扫码登录与暂不可用的 Cookie 导入引导。
- `src/presentation.ts`：未核验/历史缓存/服务器核验的纯函数映射。没有明确服务器核验时间和来源时，不展示百分比。
- `src/bridge.ts`：在已存在的 Tauri IPC 上增加响应 ID、平台身份及课程字段校验；雨课堂配置、清理和视频读取操作保持不变。
- `tests/presentation.test.cjs`：Node 纯函数与错误脱敏测试，不调用真实平台。

浏览器预览没有 Tauri 时只显示未接入状态。浅/深色外观偏好存储于本机 localStorage，不保存账号凭据。新界面的知到 Cookie 输入/文件导入尚未接线；原版知到 WPF 仍可独立使用。
