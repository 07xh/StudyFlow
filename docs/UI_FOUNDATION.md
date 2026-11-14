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

## 第三方源码来源说明

LightC-UI 2.18.3 用户上传源码已找到。本轮只选择性适配通用控件和侧栏的交互设计，
并移除了原项目特定模块依赖；平台业务和通信契约保持原状。

## 验收

- CI 执行 Python pytest 与前端 TypeScript/Vite build。
- Windows 打包仍由手动触发的 Windows workflow 负责。
- CI 成功不表示已通过真实登录/课程或 Windows 安装验收。

## LightC-UI 2.18.3 选择性组件适配

从用户提供的 `LightC-UI-源码-2.18.3.zip` 中选取独立控件的交互实现进行适配。
本次只采用三态主题选择、原生复选框开关逻辑、通用空数据态和侧栏折叠/记忆设计，
落地在 `ThemeModeSelector`、`Switch`、`EmptyState` 和 `AppShell`。
移除了原应用的清理模块、i18n、Tailwind、专属 Context 等依赖，保留 StudyFlow 的
Tauri IPC、平台登录及真实课程读取逻辑。不复制原应用的完整界面或无关业务。

## 并行知到迁移兼容
保留最新主分支的 `ZhidaoLoginPanel`、服务端核验契约 `presentCourse`、`fetchCoursesFromDesktop` 输入校验以及 `Course` 的 `progress_evidence/stale/verified_at`，避免把未核验进度展示成真实进度。
