# 学序 · StudyFlow 独立 React UI

按知到 WPF/UI 迁移基线独立实现：课程类型及核验标签、动态单列/双列课程卡片、浅/深色主题、服务端会话状态与登录交互引导、窄侧边栏和高 DPI 友好布局。未复制 LightC-UI 的专有源码、资源或品牌。

```bash
npm install
npm run build
npm test
npm run dev
```

## 真实连接与数据边界

页面仅使用可信桌面宿主注入的 `window.studyflowTransport.request`，请求 `platform.status` 与 `courses.list`。没有注入时，明确显示「桌面 IPC 运行时尚未接入」，课程列表为空；不使用本地模拟课程或固定成功状态。

`fetchCourses` 校验返回对象的平台、课程身份和标题；只有 `progress_evidence = "server_verified"`、非历史缓存且具有服务端核验时间时，UI 才展示百分比。**当前后端没有输出这一证据，故正常情况下不显示课程进度条。**

扫码登录、直接输入 Cookie、导入 Cookie 的 UI 目前只是说明选择，按钮禁用。网页前端不读取 Cookie 文件、不要求粘贴账号凭据，也不直接调用旧 WPF PowerShell 脚本。真实登录需等待受保护的 Windows 本机宿主及专属认证适配器完成验收。

主题选择在当前设备浏览器 `localStorage` 中存储 `light/dark`，不含身份信息。响应式适配和桌面缩放需要额外真机验收。
