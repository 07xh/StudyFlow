# StudyFlow · LightC 交互组件选择性适配

本轮使用用户提供的 `LightC-UI-源码-2.18.3.zip` 作为交互实现参考，
只移植适合学习助手的成熟交互方式，并改写为学序独立组件接口与样式：

- `ConfirmDialog`：沿用二次确认的交互结构，换成 StudyFlow 配色、属性契约和无依赖 CSS。
  已用于雨课堂会话清除，解决误操作风险；处理期间不能重复确认或关闭。
- `NoticeBanner`：可关闭的状态通知；保留真实 IPC 错误信息，不会自动消失掩盖故障。
- `PageSurface`：页面淡入位移动画，无延迟挂载和过期数据，支持“减少动态效果”系统设置。

**保留**：扫码弹窗、登录桥、课程筛选、平台适配器、章节列表、深浅色/跟随系统主题、
紧凑卡片、侧栏折叠以及既有 Python sidecar。没有修改真实课程或进度实现。

验证建议：前端 `npm --prefix frontend run build`，
Python `pytest -q`，Windows 打包 `scripts/build-windows.ps1`，
手动对比窄窗口、缩放、键盘 Tab/Escape、清除失败分支、扫码弹窗叠放和主题状态。

本轮 UI 代码迁移不意味着官方登录、视频进度或 Windows EXE 已通过端到端验收。
