# StudyFlow 源码来源与可追溯记录

## 知到

- UI/业务审计基线：`07xh/zhidao-assistant@53c92446d40b2cd1732c9aa1884d9f3b3a3fe55a`。
- 该版本保留 WPF 动态课程卡片、扫码二维码刷新与清理、Cookie 输入/导入、服务端进度分离展示及高 DPI 改造。
- StudyFlow `frontend/src/App.tsx`、`style.css`、`presentation.ts` 只迁移对应 UI 的交互原则，使用自有 React/TypeScript 组件；未直接复制旧 XAML/WPF PowerShell GUI。
- `platforms/zhidao/courses.py` 与 `diagnostics.py` 先前迁入自旧项目的纯 Python 只读逻辑；本轮修复 `legacy_runtime.py` 的旧安装位置，新增保留课程类型/历史缓存及去重身份标识。
- 旧仓库及其许可证、第三方 ZHS GPL-3.0 依赖应继续保留并在发行前完成许可审查。

## 雨课堂

- 源码来源：`07xh/yuketang-heartbeat`。
- 只读章节及视频元数据提取已在 `platforms/yuketang/readonly.py` 中隔离；尚未完成账号登录、课程列表适配和桌面运行时接线。
- 不在 UI 中伪造视频进度或替换真实平台返回值。

## LightC 2.18.3

- 当前仓库已有审查：`docs/LIGHTC_UI_REVIEW.md`。许可证为 Source Available，不允许把受限组件作为 StudyFlow 公共发布代码直接搬用。
- 此次 UI 使用自有 React 组件与基础 UI 模式，未复制 LightC 专有源码、品牌、图像或打包资源。

## 交付边界

此轮仅建立统一 React UI + 已有只读 Python IPC 的数据绑定契约。Tauri 可信宿主尚未接入，正式 EXE 尚未构建。任何「可用」结论以真实 Windows 集成和对应测试为准。
