# LightC 2.18.3 风格仪表盘重构

验收视觉基准：用户提供的《统一学习助手深色仪表盘.png》（2026-11-14）。

## 复刻范围

- 深色蓝紫背景、紫色选中态、圆角边框和平台状态胶囊。
- 左侧七项导航：首页、课程中心、学习任务、平台管理、学习记录、日志中心、设置。
- 首页标题区、双平台卡片、四项真实统计、横向课程概览列表。
- 小窗口时导航收窄、卡片单列、登录字段单列、课程行自动换行。
- 深浅色主题、减少动态效果、键盘焦点与禁用态。

## 平台登录归属

登录控件不再作为平台列表下方的独立大面板：

- 知到扫码登录与原版登录窗口入口，作为知到卡片的展开内容。
- 雨课堂 Session/CSRF/课堂/学校字段，作为雨课堂卡片的展开内容；保存后仍由 Windows 凭据管理器存储。
- 登录展开状态按平台独立维护。
- 登录卡片中的“进入课程”和“同步课程”只操作当前平台。
- 原版心跳任务放在“学习任务”页面，不和登录凭据配置混在一起。

## 数据真实性

预览图里的 8 门课程、5 门学习中、3 门完成、62% 总进度和示例用户名均为设计稿内容，不进入应用代码。首页统计仅由已同步课程计算；学习中/已完成/总进度只使用带 `server_verified` 与 `verified_at` 的平台数据。没有真实课程时展示空状态，不填充样例课程。

## LightC 源码使用边界

仓库中的 `docs/LIGHTC_UI_REVIEW.md` 已记录用户提供的 LightC-UI 2.18.3 压缩包采用 LightC Source Available License v1.0。该许可不授权把受限源码/组件直接复制到 StudyFlow 公开仓库并作为独立产品分发。

本次按用户预览图和交互目标，使用 StudyFlow 自有 React/TypeScript 组件与 CSS 独立实现视觉结构；不复制 LightC 原组件、资源或派生代码。现有的 `EmptyState`、`ConfirmDialog`、`NoticeBanner` 等也维持本仓库自己的接口与样式。

## 代码入口

- `frontend/src/ui/AppShell.tsx`：导航、应用标题区、主题与刷新入口
- `frontend/src/ui/PlatformCard.tsx`：平台卡片及内嵌登录展开区域
- `frontend/src/components/ZhidaoMigration.tsx`：知到卡片内登录面板
- `frontend/src/components/YuketangLoginPanel.tsx`：雨课堂卡片内会话配置
- `frontend/src/App.tsx`：真实数据、统计、课程概览、任务、记录和操作日志
- `frontend/src/style.css`：独立视觉样式与响应式规则
- `frontend/tests/lightc-inline-platform-ui.test.cjs`：登录归属与预览数据真实性回归测试

构建和真机截图验收完成前，不视为最终发布 UI。
