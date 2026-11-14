# 学序 · StudyFlow

Windows 多平台学习助手。统一 UI、课程列表与任务管理，平台登录及业务模块保持隔离。

> 状态：初始工程基线。知到、雨课堂与 LightC-UI 的真实源码尚未完成移植；目前不宣称可登录或播放。

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
