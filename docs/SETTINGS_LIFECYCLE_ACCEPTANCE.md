# 学序参数设置验收规范（无需日常重启）

> 目标：用户保存参数后，不要求退出学序；新任务读取已保存的最新设置。重启 EXE 用于**回归验收**，不是用户修改参数的必需步骤。

## 两条独立的通过门槛

**功能链（操作与生效）：**
1. 使用当前 Windows EXE，进入目标平台的正确设置作用域（全局/当前课程/当前课堂），读取初始值并记录。
2. 逐个更改每个可保存字段：布尔值双向切换、枚举每个候选项、数字边界值及有代表性的小数。确认“未保存”状态可辨认。
3. 点击保存，必须等待 IPC/后端返回，立即独立执行一次 `*.settings.get`；比较持久化值与用户提交值（包括类型与作用域），**不能只比较输入框**。
4. 关闭设置弹窗 → 重新打开 → 由后端重新读取，确认所有字段仍保持一致。
5. 若有未保存修改，关闭后再次打开必须遵守明确的保留或放弃策略，不能悄悄覆盖最后已保存值。
6. 新任务开始前重新读取有效配置；核查本次实际使用的参数快照。已运行任务仅热更新明确标注支持的参数，其余标注“下次启动任务生效”。
7. 写入失败、配置文件损坏、无权限、部分写入或错误字段，必须明确报错，保留最后已知有效值，不得报告成功或静默重置。

**持久化链（版本/进程）：**
1. 在功能链成功后，正常退出 `studyflow.exe` 并确认后台 sidecar 已退出。
2. 重新启动 **真实安装的 EXE**，重新进入相同作用域的设置页，并与磁盘持久化回读结果逐字段对照。
3. 在重启后启动一个新任务，核查本次任务的真实参数快照；不能仅因 UI 显示相同数字就判定生效。
4. 有条件时执行升级安装包回归；确认用户数据不丢失、跨版本迁移不悄悄恢复默认值。

## 平台与参数清单

| 平台 / 作用域 | 必须逐项验证 |
| --- | --- |
| 知到 ZHS（按课程） | `speed`、`speed_cap`、`limit_minutes`、`learn_optional`、`max_videos`、`stop_on_error`、`concurrency`、`completion_threshold` |
| 雨课堂（平台级） | `video_speed`、`heartbeat_interval`、`max_concurrent_videos`、`completion_threshold`、`skip_completed`、`use_concurrent`、`test_mode`、`test_video_count`、`auto_richtext`、`debug`、`richtext_stay_seconds`、`richtext_skip_delay` |
| 学习通（平台级） | `playback_speed`、`concurrency`、`skip_completed`、`verify_after_run` |
| 课程/课堂额外作用域 | ZHS 的 `scope_mode`、`resource_mode`、`selected_ids`；雨课堂按课堂阈值及作用域身份。此类浏览器本地配置必须单独覆盖“关闭、重开、退出并启动 EXE”的试验，不得当作后端 JSON 测试已覆盖 |
| 后续平台 | 如 U校园：新增字段时必须先确定存储位置、作用域、加载时机、运行参数映射，并加入对应回归矩阵 |

历史官方播放器已退役；原有配置文件留存，不再作为有效设置参与保存或验收。

## 本仓库自动化覆盖与边界

- `tests/test_settings_lifecycle_contract.py`：使用隔离的本机设置目录，通过真实 bridge 对以上三类现有后端设置的**每个后端字段**分别执行更改 → 保存 → 再次 GET；最后启动一个**新的 Python 解释器**回读并测试非法字段拒绝。禁止使用真实账号或请求外部平台。
- `frontend/tests/xuexitongSettingsFreshRead.test.cjs`：学习通课程页不得用过期值覆盖另一设置页的新值；显式修改的字段才可以覆盖。
- `tests/test_settings_corruption.py`：学习通配置损坏时回读报错且普通保存不能破坏坏文件。
- Windows CI `scripts/test-windows-install.ps1` 目前负责安装、升级、启动、退出及部分安装后 bridge 读取。**不包含完整的 Windows WebView GUI 逐字段点击及实际任务验证。**

**注意：** 自动测试中的“新 Python 进程读取”不是“真实 EXE 完整重启”。这两种证据必须分别报告，绝不可互相替代。所有平台的实际生效验收应有可核查的本次启动参数来源，避免仅依据输入框或旧日志报告成功。对平台服务器的完成状态，不用本地计时或本地状态替代平台确认。
