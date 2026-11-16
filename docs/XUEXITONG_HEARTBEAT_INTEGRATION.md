# 学习通本地心跳：应用级接线补丁（v2）

基准分支：`feat/xuexitong-unified-platform-20261116`
基线提交：`bf191f7` + 本次 v2 整改
定位：**保持自生成虚构心跳路线**，不接官方网页播放器、不改成真实观看模拟。

---

## 0. 审计 P0 的真实解法：复用已有长驻进程，不新建架构

审计指出 `src-tauri/src/lib.rs:342-358` 的普通 IPC 是「spawn → 写一行 → `wait_with_output()`」，
子进程一退出，`service.py` 的守护线程就没了。这个判断成立。

但同一文件 `lib.rs:14-55` 已经存在 **`QrBridgeWorker`**：`Command::new(binary)` 启动
`studyflow-bridge.exe`（无参数 → `bridge_entry.main()` → `services/bridge.py::main()`），
持有 `ChildStdin` / `BufReader<ChildStdout>` 跨请求复用，`bridge_request` 里
`zhidao.qr.*` 已经走这条长驻通道，并挂在 `Arc<Mutex<Option<QrBridgeWorker>>>` state 上。

`bridge.py::main()` 本身就是 `for raw in sys.stdin.buffer` 的长驻 JSONL 循环。
因此最小修复不是新建 worker、不是新建窗口、不是新建第二套 Python 进程，而是：

1. 把 `xuexitong.heartbeat.*` 也路由到这条已存在的长驻通道（Rust 一行判断）。
2. 在 `bridge.py` 注册 6 个 operation，服务单例由
   `src/studyflow/services/xuexitong_heartbeat_bridge.py` 持有（进程不退 → 线程存活）。
3. 退出前先发 `stop` 再回收子进程，让状态原子落盘。

`xuexitong_heartbeat_bridge.py` 已随本次交付入库，**不需要**：新 worker 二进制、
新 Tauri state 类型、新的 UI 框架、云端托管、浏览器扩展。

---

## 1. `src/studyflow/services/bridge.py`（Python，两处增量）

### 1.1 import 区追加

```python
from studyflow.services.xuexitong_heartbeat_bridge import dispatch as xuexitong_heartbeat_dispatch
```

放在现有 `from studyflow.platforms.xuexitong import settings as xuexitong_settings`
之后即可（该模块自带 `atexit.register(shutdown)`，进程 EOF 时会 stop + wait）。

### 1.2 `dispatch()` 内，在 `if operation == "ping":` 之前插入

```python
    heartbeat = xuexitong_heartbeat_dispatch(operation, request)
    if heartbeat is not None:
        if heartbeat.get("ok") is True:
            return {"id": request_id, "ok": True, "data": heartbeat}
        return {"id": request_id, "ok": False,
                "error": str(heartbeat.get("error") or "XUEXITONG_INTERNAL_ERROR")}
```

`dispatch()` 对非心跳 operation 返回 `None`，不会改变任何既有分支。
`course_id`（统一 UI 字段）在该层映射成 `course_key`（运行器契约）。

### 1.3 可选：stdio 保护

`bridge_entry._prepare_jsonl_stdout()` 已把业务模块的 print 重定向到 stderr，
心跳服务本身不打印，无需额外处理。

---

## 2. `src-tauri/src/lib.rs`（Rust，三处增量）

### 2.1 `validate()`：把心跳 operation 加进白名单

在 `"xuexitong.settings.get" => Ok(())` 那一行所在的 match 分支里，
追加下列 arm（放在 `"xuexitong.chapters.list"` 分支前后均可）：

```rust
        "xuexitong.heartbeat.start" if request.get("course_id").and_then(|v| v.as_str())
            .is_some_and(|value| {
                let parts: Vec<&str> = value.split(':').collect();
                parts.len() == 3 && parts.iter().all(|part|
                    !part.is_empty() && part.len() <= 24
                    && part.bytes().all(|c| c.is_ascii_digit()))
            })
            && request.get("settings").map_or(true, |value| value.is_object()) => Ok(()),
        "xuexitong.heartbeat.status" | "xuexitong.heartbeat.logs"
        | "xuexitong.heartbeat.pause" | "xuexitong.heartbeat.resume"
        | "xuexitong.heartbeat.stop" => Ok(()),
```

> 若要对 speed / jobs 做更严格的原生校验，可再加 guard；Python 侧
> `RunConfig.validate()` 已经是第二道校验（0.25–2.0 / 1–4 / 30–90 视频秒）。

### 2.2 `bridge_request()`：扩大长驻通道判定

把现有的

```rust
    let is_qr = request.get("operation").and_then(|x| x.as_str())
        .map_or(false, |op| op.starts_with("zhidao.qr."));
    if is_qr {
```

替换为

```rust
    // QR and the persistent Xuexitong heartbeat runner must share a long-lived
    // Python process; one-shot requests keep their existing behavior.
    let is_persistent = request.get("operation").and_then(|x| x.as_str())
        .map_or(false, |op| op.starts_with("zhidao.qr.")
                        || op.starts_with("xuexitong.heartbeat."));
    if is_persistent {
```

分支体（`shared` / `QrBridgeState` / `spawn_blocking` / `request()` / 失败时 `*slot = None`）
**完全不用改**。

### 2.3 `shutdown_owned_services()`：先停队列再回收子进程

把现有的 QR 清理块：

```rust
    let qr_worker = app.state::<QrBridgeState>();
    if let Ok(mut guard) = qr_worker.lock() {
        guard.take();
    };
```

替换为：

```rust
    let qr_worker = app.state::<QrBridgeState>();
    if let Ok(mut guard) = qr_worker.lock() {
        if let Some(worker) = guard.as_mut() {
            // Graceful stop: flush heartbeat state before the child is killed.
            let _ = worker.request(
                b"{\"id\":\"hb-shutdown\",\"version\":1,\"operation\":\"xuexitong.heartbeat.stop\"}\n",
                "hb-shutdown",
            );
        }
        guard.take();
    };
```

`QrBridgeWorker::request` 是同步读一行，Python 侧 `stop` 会立即返回，
随后 `Drop` 发 QR cancel 并 kill 子进程，不会卡住退出流程。

> **不需要**改 `.manage(...)`、不需要新增 struct、不需要改 `invoke_handler`。

---

## 3. `frontend/src/bridge.ts`（TypeScript，两处增量）

### 3.1 类型定义区追加（放在 `XuexitongSettings` 附近）

```ts
export type HeartbeatTaskView={
  task_id:string;run_id:string;course_key:string;chapter:string;title:string;
  state:string;playing_time:number;duration:number;speed:number;
  last_send_state:string;sent_count:number;server_confirmed:boolean;
  server_play_time:number;end_reason:string;confirmed:boolean;resumable:boolean;
};
export type HeartbeatStatus={
  ok:boolean;running:boolean;run_id:string;course_key:string;
  config:{speed:number;jobs:number;instant_complete:boolean;randomize_interval:boolean};
  task_count:number;tasks:HeartbeatTaskView[];
  heartbeats:{sent:number;server_confirmed:number};
  queue_controls:{pause:boolean;resume:boolean;stop:boolean};
};
export type HeartbeatLog={event:string;at:number;[key:string]:unknown};
export type HeartbeatControlResult={ok:boolean;action?:string;run_id?:string;error?:string};
export type HeartbeatStartResult={
  ok:boolean;started:boolean;run_id:string;course_key:string;
  task_count:number;chapter_count:number;speed:number;jobs:number;instant_complete:boolean;
};
```

### 3.2 `BridgeRequest` 联合类型追加 6 个成员

```ts
  | {id:string;version:1;operation:"xuexitong.heartbeat.start";course_id:string;
     speed?:number;jobs?:number;instant_complete?:boolean;settings?:XuexitongSettings;
     heartbeat_interval_video_seconds?:number;max_wall_seconds?:number;
     max_unconfirmed_rounds?:number;completion_rounds?:number;max_ticks?:number;dtype?:string}
  | {id:string;version:1;operation:"xuexitong.heartbeat.status"}
  | {id:string;version:1;operation:"xuexitong.heartbeat.logs";limit?:number}
  | {id:string;version:1;operation:"xuexitong.heartbeat.pause";run_id?:string}
  | {id:string;version:1;operation:"xuexitong.heartbeat.resume";run_id?:string}
  | {id:string;version:1;operation:"xuexitong.heartbeat.stop";run_id?:string}
```

`request<T>()` 现有实现直接复用，无需新增 IPC 函数。

---

## 4. 统一 UI 挂载

`integration/frontend/XuexitongHeartbeatPanel.tsx` 是完整组件，直接复制：

```bash
cp integration/frontend/XuexitongHeartbeatPanel.tsx \
   frontend/src/components/XuexitongHeartbeatPanel.tsx
```

在 `frontend/src/components/XuexitongPanels.tsx` 的
`XuexitongCourseDetailPanel` 里 import 并挂在课程详情下方：

```tsx
import {XuexitongHeartbeatPanel} from "./XuexitongHeartbeatPanel";

// XuexitongCourseDetailPanel 的 return 内、章节任务列表之后：
<XuexitongHeartbeatPanel course={course} desktop={desktop}/>
```

`platformRegistry` / `AppShell` / `registry.ts` **都不用改**：学习通已在第三平台注册，
该组件复用现有课程详情页面，不新建导航、不新建窗口。

---

## 5. 合入顺序与验证

```bash
# 1) 本次已入库的模块（无需手动复制）
#    src/studyflow/platforms/xuexitong/{heartbeat,runner,state,service,pacing,taskparse,settings}.py
#    src/studyflow/services/xuexitong_heartbeat_bridge.py
#    src/studyflow/platforms/xuexitong/adapter.py（解析统一）
#    tests/test_xuexitong_heartbeat.py、tests/test_xuexitong_bridge.py

# 2) 应用上面 4 处增量补丁
# 3) 离线回归（不发真实请求）
python -m unittest discover -s tests -p "test_xuexitong*.py" -v
python -m compileall -q src tests

# 4) 前端 / Rust
npm run build            # 或 npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
```

实机验收（未做，需真实账号）：

| 检查 | 期望 |
| --- | --- |
| 点「开始」后连续 5 次 status | `running=true` 不因请求结束而消失 |
| `sent` 与 `server_confirmed` | 两列独立增长，`reported` 不显示为完成 |
| 暂停 30s 再继续 | `playing_time` 不跳变，不触发 `wall_timeout` |
| 启动后立即停止 | 队列不启动任何新任务，状态落盘 `stopped` |
| 切换课程再查 status | 只显示当前 `run_id` / 当前课程的任务 |
| 退出 EXE 再打开 | 中断任务 `resumable=true`，可断点续跑 |
| 知到 / 雨课堂 | 原有功能无回归 |
| Windows NSIS 安装包 | Sidecar 内 `requests` / `bs4` 与心跳模块均可用 |

---

## 6. 边界（必须如实标注）

- 本模块**只对真实学习通账号发包才能验证**：`isPassed` 实际返回、`dtoken` 有效期、
  403 风控阈值、随机间隔是否被接受，全部未做实机验证。
- 单次 `isPassed=True` 只证明该任务点被平台判定通过，**不等于整门课程完成**；
  课程总进度与章节任务状态是另一套只读口径。
- `sent`（本地请求已发出）与 `server_confirmed`（服务端确认）严格分离；
  UI 不得把 `reported` 显示成已完成。
- 音频任务已按 `dtype="Audio"` 分流：卡解析 → 目标 → 发包 → UI 筛选全链路已接通；
  音频与视频共用 `/ananas/status` 取 `dtoken` / `duration`，真实账号下的服务端行为未验证。
- 上游 `Samueli924/chaoxing` 的验证码 OCR / 自动重登录 / tqdm 进度条**没有复用**；
  403 只做只读 status 刷新 + rt 回退，验证码与会话失效直接判终态。

---

## 7. 合入状态（2026-11-16）

四处接线由分支上的并发提交完成：`413c889a`（长驻心跳 IPC、课程工作区、bridge 回归）、
`78eb4cae`（账号隔离恢复、真实发送计数、登出安全的 worker）、`fd85e67e`（账号隔离与音频分流回归）、
`9f762e5b`（队列级暂停与 Sidecar 优雅退出交接）。收尾提交在这些改动之上补齐 Rust 入参校验、
`XUEXITONG_NO_ACTIVE_TASK` 中文提示、`integration/frontend` 组件副本同步与验证数字，
未覆盖并发提交引入的账号隔离与计数修正。以下为仓库现状，无需手工复制补丁：

| 文件 | 合入内容 |
| --- | --- |
| `src/studyflow/services/bridge.py` | import 心跳桥 + `dispatch()` 内 6 个 operation 路由到长驻服务单例 |
| `src-tauri/src/lib.rs` | `validate()` 白名单（`dtype` / `speed` / `jobs` / `course_id` / `limit` / `run_id` 校验）、`bridge_request()` 长驻通道判定、退出前发 `stop` 刷盘 |
| `frontend/src/bridge.ts` | 心跳视图类型 + `BridgeRequest` 6 个成员 + 公开错误码与中文提示 |
| `frontend/src/components/XuexitongPanels.tsx` | 课程详情下方挂载 `XuexitongHeartbeatPanel` |
| `frontend/src/components/XuexitongHeartbeatPanel.tsx` | 任务面板（新增），含速度 / 并发 / 首包申报 / 任务类型筛选 / 防重入刷新 / 课程切换防串台 |
| `integration/frontend/XuexitongHeartbeatPanel.tsx` | 可复制组件副本，与 `frontend/src/components/` 下正式组件逐字节一致 |

### 视频与音频 dtype 分流

`taskparse.iter_media_cards()` 识别的音频卡不再被丢弃：`adapter.VideoTask` 与
`heartbeat.VideoTarget` 携带 `dtype`，`runner` 发包按目标自身 `dtype` 选择
`VIDEO_HEADERS` / `AUDIO_HEADERS` 与 `enc` 参数；`service.start()` 在显式传入
`dtype` 时按类型过滤任务，无匹配返回 `XUEXITONG_NO_TARGET_FOR_DTYPE`。
UI 的「任务类型」下拉提供「视频 + 音频 / 仅视频 / 仅音频」，默认全跑。

### 验证

```text
Ran 65 tests in 0.387s — OK（连续 2 次）
COMPILE_OK
Python / Rust / TypeScript 三方 operation 集合一致：6 / 6 / 6
（校验统计各文件中全部 `xuexitong.heartbeat.*` 字面量，不受 TS 把
`pause | resume | stop` 写成单个并集成员的影响）
```

用例分布：`test_xuexitong_heartbeat.py` 47 项（含账号隔离恢复、真实发送计数、
队列级暂停）、`test_xuexitong_bridge.py` 8 项（含登出安全 worker）、
`tests/test_xuexitong_audio_dtype.py` 10 项（卡解析双类型、目标 dtype 继承、
音频 headers、runner 按目标发包、服务按 dtype 过滤与空集合错误码）。

### 仍未执行

- 真实学习通账号发包、`isPassed` 实际返回、`dtoken` 有效期与 403 风控阈值。
- `cargo test` / `npm run build`：本机没有 Rust 与 TypeScript 工具链。
- Windows NSIS 安装包内 Sidecar 依赖（`requests` / `bs4`）与心跳模块联调。

