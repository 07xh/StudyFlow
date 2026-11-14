# StudyFlow 统一 UI 底座 · 第一轮

## 目标

保持现有 Tauri ↔ Python IPC 与两个既有业务适配器不变，先建立平台无关的 UI 组件层。
本轮只移动和封装界面职责，不删除既有功能、不添加虚构课程或进度。

## 组件

- `frontend/src/ui/registry.ts`：平台显示名称、标识、能力声明和本地初始状态。新增平台时先实现 Python/Tauri 后端，再登记此处。
- `frontend/src/ui/AppShell.tsx`：响应式侧栏、页面标题、运行环境和通知。
- `frontend/src/ui/PlatformCard.tsx`：平台连接状态及按能力展示操作。
- `frontend/src/ui/CourseCard.tsx`：课程与有来源的进度条；空进度不显示百分比。
- `frontend/src/ui/useAppearance.ts`：深浅主题本地记忆。
- `frontend/src/ui/foundation.css`：组件样式变量、窄窗口布局、键盘焦点和减少动态效果。

## 与现有业务保持兼容

- 知到：原版扫码登录窗口、连接检测、课程同步。
- 雨课堂：会话录入/保存、凭据清除、连接检测、课程同步、视频列表。
- 仍使用原有 `bridge_request` 和 `launch_zhidao_legacy` Tauri commands。
- `App.tsx` 负责页面业务编排，组件不直接持有凭据或调用 Python。
- 浏览器预览禁用真实平台按钮，不虚构后端连接。

## 后续接入第三平台

1. 在 Python 中实现独立适配器和真实数据契约。
2. 扩充 IPC 允许的操作及相关状态/安全校验。
3. 向 `platformRegistry` 注册显示信息与已实现的能力。
4. 复用 AppShell / PlatformCard / CourseCard；独有功能另建模块页面。
5. 完成真实账号端到端验收，最后再标记为可用。

## 第三方 UI 参考与许可边界

- 已读取用户提供的 `LightC-UI-源码-2.18.3.zip`，其根目录许可证为 **LightC Source Available License v1.0**，不是 OSI 开源许可证。
- 许可证允许个人教育、研究和非商业修改，但限制未经权利人书面许可分发修改版、编译安装包或将其作为独立产品的一部分。
- StudyFlow 仓库为公开仓库且会构建 Windows 安装程序，因此不得复制、改写或打包该压缩包中的源码、组件、资源或其衍生实现。
- StudyFlow 的 `AppShell`、`Switch`、`EmptyState`、`ThemeModeSelector` 均由本项目独立实现；只保留高层交互目标，不复用上游代码或素材。

## 验收

- CI 执行 Python pytest 与前端 TypeScript/Vite build。
- PR 和手动验证执行完整 Windows NSIS 构建；主分支推送由独立 Windows workflow 生成安装包。
- CI 成功不表示已通过真实登录/课程或 Windows 安装验收。

## StudyFlow 自有通用控件

- `ThemeModeSelector`：三态主题按钮组，使用 `aria-pressed` 表达当前选项。
- `Switch`：基于原生 checkbox 的可访问开关，保留键盘焦点和禁用语义。
- `EmptyState`：统一空数据展示，支持标题、说明和操作入口。
- `AppShell`：悬浮导航、触摸/鼠标/键盘交互、固定状态和平台二级导航。

这些控件使用 StudyFlow 自有 JSX、状态和 CSS 实现，不包含 LightC 源码或资源。不复制原应用的完整界面或无关业务。

## 并行知到迁移兼容
保留最新主分支的 `ZhidaoLoginPanel`、服务端核验契约 `presentCourse`、`fetchCoursesFromDesktop` 输入校验以及 `Course` 的 `progress_evidence/stale/verified_at`，避免把未核验进度展示成真实进度。
