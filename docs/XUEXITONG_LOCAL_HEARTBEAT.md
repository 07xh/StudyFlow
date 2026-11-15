# 学习通本地心跳模块（M3）— 独立客户端进度包

目标：在学序 Windows EXE 的 Python Sidecar 内，**本地生成并发送**学习进度心跳包，
用于申报观看时长与完成状态。不走云端托管、不依赖官方网页播放器或浏览器扩展。

交付基线：`07xh/StudyFlow` 分支 `feat/xuexitong-unified-platform-20261116`
（`f91f1d68fa8acb1e9cc0c234179a0059a1335b5a`）。该文件下的 `adapter.py`、
`credentials.py`、`core/models.py`、`core/platform_api.py` 为分支原样快照，**未修改**。

---

## 一、交付清单

| 文件 | 作用 |
| --- | --- |
| `src/studyflow/platforms/xuexitong/heartbeat.py` | 心跳包生成、enc、rt、限流、本地发送、响应分类 |
| `src/studyflow/platforms/xuexitong/runner.py` | 速度、任务状态机、暂停/恢复/停止、章节并发队列 |
| `src/studyflow/platforms/xuexitong/state.py` | 原子持久化、断点续跑、不含凭据 |
| `src/studyflow/platforms/xuexitong/service.py` | Sidecar 唯一入口：凭据 → 任务发现 → 队列 → 日志 → JSONL IPC |
| `tests/test_xuexitong_heartbeat.py` | 27 项离线验证，注入假 session / 假时钟 |
| `docs/licenses/GPL-3.0-Samueli924-chaoxing.txt` | 上游 GPL-3.0 全文 |
| `docs/LICENSE_PROVENANCE.addendum.md` | 增量许可证登记 |

---

## 二、心跳包结构（与上游字节级一致）

`GET https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/{cpi}/{dtoken}`

| 参数 | 值 / 来源 | 说明 |
| --- | --- | --- |
| `clazzId` | `VideoTarget.clazz_id` | 教学班 |
| `courseId` | `VideoTarget.course_id` | 课程 |
| `cpi`（路径） | `VideoTarget.cpi` | 课程实例 |
| `dtoken`（路径） | `VideoTarget.dtoken` | `ananas/status` 返回，会过期 |
| `jobid` | `VideoTarget.job_id` | 任务点 |
| `objectId` | `VideoTarget.object_id` | 视频对象 |
| `otherInfo` | `VideoTarget.other_info` | 节点信息，含 `-rt_1` / `-rt_d` |
| `userid` | cookie `_uid` / `UID` | 由 `identity_from_cookies()` 提取 |
| `playingTime` | **本地生成** | 申报的观看秒数 |
| `duration` | `VideoTarget.duration` | 视频总长 |
| `clipTime` | `0_{duration}` | 固定拼法 |
| `isdrag` | `3` / `4` | `4` = 完成态首包 |
| `view` | `pc` | 客户端形态 |
| `dtype` | `Video` / `Audio` | 任务类型 |
| `enc` | **本地 MD5** | 见下 |
| `rt` | `0.9` / `1` | 优先 `job.rt`，其次 `otherInfo` 推导，最后回退 |
| `_t` | 毫秒时间戳 | 每次发包重算 |
| `videoFaceCaptureEnc` / `attDuration` / `attDurationEnc` | 可选 | 由 adapter 透传 |

### enc 算法

```text
raw = f"[{clazzId}][{userid}][{jobid}][{objectId}][{playingTime * 1000}]"
      f"[d_yHJ!$pdA~5][{duration * 1000}][0_{duration}]"
enc  = md5(raw.encode()).hexdigest()
```

请求头：`Referer: https://mooc1.chaoxing.com/ananas/modules/video/index.html?v=2025-0725-1842`
（音频走 `index_new.html?v=2025-0725-1842`）。

### 两个申报入口

| 入口 | 调用 | 效果 |
| --- | --- | --- |
| 申报完成状态 | `build_completion_packet(target)` | `playingTime = duration`，`isdrag = 4`，即上游「任务瞬间完成」首包 |
| 申报任意观看时长 | `build_packet(target, playing_time)` | `playingTime = playing_time`，`isdrag = 3` |

两者都只生成本地数据包。**是否生效以服务端 `isPassed` 为准**，本地不自行判定完成。

---

## 三、状态分类（`SendState`）

| 状态 | 触发 | `sent` | `server_confirmed` | 处置 |
| --- | --- | --- | --- | --- |
| `CONFIRMED` | 200 且 `isPassed == true` | true | **true** | 唯一允许置 `SUCCEEDED` |
| `REPORTED` | 200 且 `isPassed == false` | true | false | 包已发出，继续推进播放时间 |
| `FORBIDDEN` | 403 | true | false | 切换 rt / 会话恢复后重试，超限失败 |
| `CAPTCHA` | 响应含「验证码」/「validate」 | true | false | 终止该任务，待人工处理 |
| `SESSION_EXPIRED` | 返回登录页 | true | false | 终止，提示重新导入会话 |
| `PROTOCOL_ERROR` | 200 但非 JSON / 缺 `isPassed` | true | false | 继续推进，记录诊断 |
| `HTTP_ERROR` | 其他非 200 | true | false | 继续推进 |
| `NETWORK_ERROR` | 连接层异常 | **false** | false | 按 `max_network_retries` 重试 |
| `INVALID_TARGET` | 本地参数校验失败 | false | false | 不发包 |

验收标准 7（本地发送结果与服务器确认结果可区分）由 `sent` / `server_confirmed`
两个独立布尔字段落地；验收标准 6（不误显示已完成）由「仅 `CONFIRMED` 置成功」落地。

---

## 四、运行参数（数值 + 范围 + 依据）

| 参数 | 主值（范围） | 依据 |
| --- | --- | --- |
| `speed` | `1.0`（`1.0–2.0`） | 上游 `config_template.ini` `speed = 1`，`main.py` `min(2.0, max(1.0, ...))` |
| `max_workers` / `jobs` | `4`（`1–16`） | 上游 `jobs = 4`，章间并发 |
| 心跳间隔（视频秒） | `60`（`30–90`） | 上游 `wait_time = int(random.uniform(30, 90))` |
| `tick_seconds` | `1.0`（`>0`） | 上游 `gc.THRESHOLD = 1` |
| 上报限流 | `2.0s`（+ `0–2.0s` 抖动） | 上游 `video_log_limiter = RateLimiter(2)`，`random_max=2` |
| 请求超时 | `(5.0, 12.0)` 秒 | 上游 adapter 的连接/读取超时 |
| `max_forbidden_retries` | `2` | 上游 `max_forbidden_retry = 2` |
| `max_network_retries` | `3` | 本项目新增，连接层独立重试 |
| `rt` 回退序列 | `0.9` → `1` | 上游 `for rt in [0.9, 1]` |
| 日志事件上限 | `500` 条 | 有界内存，避免长跑无限增长 |

速度推进公式：`play_time = min(duration, play_time + (now - last_iter) * speed)`。
`speed=2.0` 时每个 `tick_seconds` 推进 2 倍视频时间，测试已验证 `playingTime` 由 30 → 40。

---

## 五、Sidecar 内执行链路

```text
credentials.load()                    Windows Credential Manager / 环境变量
        ↓
adapter.list_video_tasks(course_key)  真实课程 → 章节 → 视频任务（现成实现，未改）
        ↓
VideoTarget.from_adapter_task()       + userid / fid
        ↓
HeartbeatSender.send(packet)          本地 GET，2s 限流，rt 回退
        ↓
ChapterQueue / HeartbeatTaskRunner    章内顺序、章间并发、暂停/恢复/停止
        ↓
StateStore                            原子 JSON，仅存进度与状态，不存 dtoken/cookie/enc
        ↓
on_event → 统一日志中心               heartbeat.sent / task.state / task.finished
        ↓
service.handle() → JSONL IPC          只输出公开错误码与状态
```

---

## 六、JSONL IPC 契约（新增 6 个 operation）

| operation | 输入 | 返回要点 |
| --- | --- | --- |
| `xuexitong.heartbeat.start` | `course_key`, `speed`, `jobs`, `instant_complete`, `heartbeat_interval_video_seconds`, `dtype` | `started`, `task_count`, `chapter_count`, `speed`, `jobs` |
| `xuexitong.heartbeat.status` | 无 | `running`, `config`, `tasks[]`, `heartbeats{sent, server_confirmed}`, `queue_controls` |
| `xuexitong.heartbeat.pause` | 无 | `ok`, `action` |
| `xuexitong.heartbeat.resume` | 无 | `ok`, `action` |
| `xuexitong.heartbeat.stop` | 无 | `ok`, `action` |
| `xuexitong.heartbeat.logs` | `limit`（≤500） | `events[]` |

公开错误码：`XUEXITONG_SESSION_MISSING`、`XUEXITONG_COURSE_REQUIRED`、
`XUEXITONG_INVALID_PARAMETER`、`XUEXITONG_INVALID_TARGET`、
`XUEXITONG_TASK_ALREADY_RUNNING`、`XUEXITONG_NO_ACTIVE_TASK`、
`XUEXITONG_UNKNOWN_OPERATION`、`XUEXITONG_INTERNAL_ERROR`。

### 接线点（增量，不另起 UI）

1. **Rust 侧 operation 白名单**：把 `service.OPERATIONS` 六个名字加入现有白名单，
   输入大小沿用既有上限；不新增 HTTP 监听端口。
2. **`src/studyflow/services/bridge.py`**：新增一个单例分发，例如

   ```python
   from studyflow.platforms.xuexitong.service import XuexitongHeartbeatService, OPERATIONS

   _xxt = XuexitongHeartbeatService(os.path.join(app_data_dir(), "xuexitong-heartbeat-state.json"))

   # 在现有 operation 分发分支中：
   if operation in OPERATIONS:
       return _xxt.handle(operation, request.get("payload") or {})
   ```

   `handle()` 已把所有异常收敛成公开错误码，stdout 不会混入业务日志。
3. **`frontend/src/bridge.ts`**：新增对应 6 个 typed wrapper，沿用现有 `bridge_request`
   的 `id` 校验与平台身份核对。
4. **`frontend/src/ui/registry.ts`**：学习通 `capabilities.videoList` 置 `true`，
   复用现有 `RuntimeTaskList` / `RunParameters` / 日志中心组件，不新建页面框架。
5. **`AppShell.tsx` / 任务中心**：消费 `status.tasks[]` 的 `state`、
   `last_send_state`、`server_confirmed`、`resumable`；进度条只由 `server_confirmed`
   驱动，未确认时显示「已发送 / 待服务端确认」。

---

## 七、源码溯源与许可证

| 项目 | 版本 | 取用内容 | 许可证 |
| --- | --- | --- | --- |
| `Samueli924/chaoxing` | `45d2106b16764231c2de2038fb042e71b23d878f` | `api/base.py`：`get_enc()`、`video_progress_log()`、`study_video()`；`api/config.py`：`VIDEO_HEADERS` / `THRESHOLD`；`config_template.ini`：`speed` / `jobs` | **GNU GPL v3**（全文见 `docs/licenses/`） |
| `lispringing/SuperStar` | `1f93cd18b6738e88dc4138545a99e87145c19350` | `api/base.py`：同源 `get_enc()` / `video_progress_log()`，仅用于算法一致性比对 | 仓库根目录**未见 LICENSE**。属同源派生，不作为主集成来源，须补做许可证核对 |
| `07xh/StudyFlow` 开发分支 | `f91f1d68fa8acb1e9cc0c234179a0059a1335b5a` | `adapter.py` / `credentials.py` / `core` 契约，原样保留 | 项目自有 |

差异结论：两个上游的心跳包构造与 `enc` 拼串**完全一致**；`chaoxing` 额外维护了
验证码处理、403 会话恢复与 `_refresh_video_status()`，维护质量更好，定为主参考。
本模块删去题库、通知、Captcha OCR、tqdm 终端进度条，保留限流与 rt 回退策略。

GPL-3.0 属强 copyleft：本模块为衍生实现，公开分发时须随包提供许可证全文、
标注来源与修改记录。登记见 `docs/LICENSE_PROVENANCE.addendum.md`。

---

## 八、验证结果

```text
python -m unittest discover -s tests -p "test_xuexitong_heartbeat.py" -v
Ran 27 tests in 0.15s — OK（连续 5 次重复运行全绿）
python -m compileall -q src/studyflow/platforms/xuexitong tests/... — COMPILE_OK
```

| 覆盖项 | 结论 |
| --- | --- |
| `enc` 与上游公式字节一致 | 通过（含不同 playingTime 的对照） |
| 完成态首包 `playingTime=duration` / `isdrag=4` | 通过 |
| 任意观看时长包 `isdrag=3` | 通过 |
| 参数齐全、可选人脸/时长字段、rt 解析与 0.9→1 回退 | 通过 |
| 200+`isPassed=true` → `CONFIRMED`；`false` → `REPORTED` 且不置成功 | 通过 |
| 403 / 验证码 / 会话失效 / 协议异常 / 网络异常 / HTTP 异常分类 | 通过 |
| `speed=1.0→30s`、`speed=2.0→40s` 实际作用于 `playingTime` | 通过 |
| 暂停 / 继续 / 停止、状态持久化与断点恢复、凭据不落盘 | 通过 |
| 章内顺序、章间并发、重复提交拦截、失败隔离 | 通过 |
| Sidecar IPC：start/status/pause/resume/stop/logs、公开输出不泄露凭据 | 通过 |
| `public_dict()` 不含 dtoken / userid / URL / enc | 通过 |

### 未验证（需真实环境）

- 未对真实学习通账号发送任何心跳包，全部测试使用注入的假 session。
- `isPassed` 的实际返回结构、`dtoken` 有效期、风控/验证码触发阈值需实机判定。
- 完成态首包在目标课程上是否被服务端接受，需用真实课程章节验证。
- Windows 打包后 Sidecar 路径、Credential Manager 读取、NSIS 安装与升级未做端到端测试。
- 知到、雨课堂功能回归未执行（本模块不改动其代码路径）。

---

## 九、合入开发分支

```bash
# 在 feat/xuexitong-unified-platform-20261116 的工作副本中执行
cp -r src/studyflow/platforms/xuexitong/{heartbeat.py,runner.py,state.py,service.py} \
      <REPO>/src/studyflow/platforms/xuexitong/
cp    tests/test_xuexitong_heartbeat.py <REPO>/tests/
cp -r docs/XUEXITONG_LOCAL_HEARTBEAT.md docs/LICENSE_PROVENANCE.addendum.md \
      docs/licenses/GPL-3.0-Samueli924-chaoxing.txt <REPO>/docs/
python -m unittest discover -s tests -p "test_xuexitong_heartbeat.py" -v
```

`research/upstream/` 仅保存上游源码快照用于比对，不参与打包。
