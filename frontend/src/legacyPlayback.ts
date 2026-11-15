import {invoke} from "@tauri-apps/api/core";
import type {Platform} from "./types";
import {isDesktop, request} from "./bridge";

export type LegacyTaskState = "idle" | "running" | "exited" | "stopped";
export type ZhsLocalProgress = {
  video_segment_percent: number | null;
  resource_index: number | null;
  resource_total: number | null;
  resource_kind?: "video" | "ppt" | "article" | "other" | null;
  resource_name?: string | null;
};

export type LegacyTaskStatus = {
  platform: Platform;
  state: LegacyTaskState;
  exit_code: number | null;
  run_id?: string | null;
  course_id: string | null;
  zhs_progress: ZhsLocalProgress | null;
  /** Metadata only; when telemetry is stale no old numeric progress is reused. */
  zhs_last_resource?: Omit<ZhsLocalProgress,"video_segment_percent"> | null;
  zhs_stale: boolean;
  diagnostic_code?: string | null; // validated against fixed native enum, never raw CLI output
};

export type YuketangLiveProgress = {
  available: boolean;
  simulation_percent: number | null;
  simulation_position: number | null;
  simulation_duration: number | null;
  server_percent: number | null;
  server_position: number | null;
  server_source: "initial" | "periodic" | "final" | null;
  total: number | null;
  processed: number;
  current_index: number | null;
  success: number;
  skipped: number;
  failed: number;
  stopped: number;
  concurrent: boolean | null;
  worker_slots: Array<{slot:number;video_index:number|null;state:"waiting"|"preparing"|"watching"|"completed"|"skipped"|"failed"|"stopped"|"unknown"}>;
  video_tasks: Array<{
    video_index: number; name: string|null;
    state: "preparing"|"watching"|"completed"|"skipped"|"failed"|"stopped"|"unknown";
    simulation_percent: number|null; simulation_position: number|null;
    simulation_duration: number|null; server_percent: number|null;
    server_position: number|null; server_source: "initial"|"periodic"|"final"|null;
  }>;
  rich_total: number | null;
  rich_current: number | null;
  rich_processed: number;
  rich_success: number;
  rich_failed: number;
};

/** Reads only the current executor run’s original logged progress. */
export async function getYuketangLiveProgress(runId: string): Promise<YuketangLiveProgress> {
  ensureDesktop();
  if (!/^[0-9]{1,15}-[0-9]{1,20}$/.test(runId)) throw new Error("INVALID_REQUEST");
  return request<YuketangLiveProgress>({operation:"yuketang.progress", run_id:runId});
}


// These course-scoped targets affect only the local worker, never verified status.
const thresholdPrefix="studyflow.yuketang.execution.";
function thresholdKey(classroom:string,university:string):string|null {
  return /^[0-9]{1,24}$/.test(classroom)&&/^[0-9]{1,24}$/.test(university)
    ?thresholdPrefix+university+"."+classroom:null;
}
export function readYuketangCourseThreshold(classroom:string,university:string):number|null {
  const key=thresholdKey(classroom,university);
  if(!key)return null;
  try {
    const raw=window.localStorage.getItem(key);
    return raw!==null&&/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw)?Number(raw):null;
  } catch {return null;}
}
export function saveYuketangCourseThreshold(classroom:string,university:string,value:number|null):void {
  const key=thresholdKey(classroom,university);
  if(!key||!(value===null||(Number.isInteger(value)&&value>=1&&value<=100)))
    throw new Error("INVALID_SETTINGS");
  if(value===null)window.localStorage.removeItem(key);
  else window.localStorage.setItem(key,String(value));
}

// ZHS 0.1.5 play flags; original heartbeat timing remains inside ZHS.
export type ZhsStoredOptions = {
  speed:number;speed_cap:number;limit_minutes:number;learn_optional:boolean;
  max_videos:number;stop_on_error:boolean;
  /** null = inherit original ZHS default for the current course type. */
  completion_threshold:number|null;
};
export type OriginalZhsOptions = ZhsStoredOptions & {
  scope_mode:"all"|"selected";selected_ids:number[];
  resource_mode?:"all"|"video"|"reading";
};
export const originalZhsDefaults:Readonly<ZhsStoredOptions> = Object.freeze({
  speed:1.5,speed_cap:2,limit_minutes:0,learn_optional:false,
  max_videos:0,stop_on_error:false,completion_threshold:null
});
export function validateZhsStoredOptions(value:ZhsStoredOptions):boolean {
  return !!value && Number.isFinite(value.speed) && value.speed>=1 && value.speed<=2 &&
    Number.isFinite(value.speed_cap) && value.speed_cap>=1 && value.speed_cap<=2 &&
    Number.isInteger(value.limit_minutes) && value.limit_minutes>=0 && value.limit_minutes<=1440 &&
    Number.isInteger(value.max_videos) && value.max_videos>=0 && value.max_videos<=1000 &&
    typeof value.learn_optional==="boolean" && typeof value.stop_on_error==="boolean" &&
    (value.completion_threshold===null ||
      (Number.isInteger(value.completion_threshold) &&
       value.completion_threshold>=1 && value.completion_threshold<=100));
}
export function validateZhsOptions(value:OriginalZhsOptions):boolean {
  const ids=value?.selected_ids;
  return validateZhsStoredOptions(value) && (value.scope_mode==="all"||value.scope_mode==="selected") &&
    Array.isArray(ids) && ids.length<=256 &&
    ids.every(id=>Number.isSafeInteger(id)&&id>0&&id<=Number.MAX_SAFE_INTEGER) &&
    new Set(ids).size===ids.length &&
    (value.scope_mode==="all"?ids.length===0:ids.length>0) &&
    (value.resource_mode===undefined||value.resource_mode==="all"||
      value.resource_mode==="video"||value.resource_mode==="reading");
}

// Names and defaults are the original YKT main.py environment settings.
// New UI only passes these parameters through. No heartbeat algorithm is copied
// into the frontend and no browser preview can launch tasks.
export type OriginalYktOptions = {
  video_speed: number;
  heartbeat_interval: number;
  max_concurrent_videos: number;
  completion_threshold: number;
  skip_completed: boolean;
  use_concurrent: boolean;
  test_mode: boolean;
  test_video_count: number;
  auto_richtext: boolean;
  debug: boolean;
  richtext_stay_seconds: number;
  richtext_skip_delay: number;
};

export const originalYktDefaults: Readonly<OriginalYktOptions> = Object.freeze({
  video_speed: 1.5,
  heartbeat_interval: 5,
  max_concurrent_videos: 3,
  completion_threshold: 90,
  skip_completed: true,
  use_concurrent: true,
  test_mode: false,
  test_video_count: 5,
  auto_richtext: false,
  debug: false,
  richtext_stay_seconds: 3,
  richtext_skip_delay: 1
});

export function validateOriginalOptions(input: OriginalYktOptions): boolean {
  return Number.isFinite(input.video_speed) && input.video_speed >= 0.1 && input.video_speed <= 4 &&
    Number.isInteger(input.heartbeat_interval) && input.heartbeat_interval >= 1 && input.heartbeat_interval <= 120 &&
    Number.isInteger(input.max_concurrent_videos) && input.max_concurrent_videos >= 1 && input.max_concurrent_videos <= 32 &&
    Number.isInteger(input.completion_threshold) && input.completion_threshold >= 0 && input.completion_threshold <= 100 &&
    Number.isInteger(input.test_video_count) && input.test_video_count >= 1 && input.test_video_count <= 10000 &&
    Number.isInteger(input.richtext_stay_seconds) && input.richtext_stay_seconds >= 0 && input.richtext_stay_seconds <= 3600 &&
    Number.isFinite(input.richtext_skip_delay) && input.richtext_skip_delay >= 0 && input.richtext_skip_delay <= 3600 &&
    typeof input.skip_completed === "boolean" && typeof input.use_concurrent === "boolean" &&
    typeof input.test_mode === "boolean" && typeof input.auto_richtext === "boolean" &&
    typeof input.debug === "boolean";
}

function ensureDesktop() {
  if (!isDesktop()) throw new Error("RUN_NOT_AVAILABLE");
}

export async function getLegacyStatus(platform: Platform): Promise<LegacyTaskStatus> {
  ensureDesktop();
  return invoke<LegacyTaskStatus>("legacy_status", {platform});
}

export async function startLegacy(
  platform: Platform, courseId?: string, options?: OriginalYktOptions, zhsOptions?: OriginalZhsOptions
): Promise<LegacyTaskStatus> {
  ensureDesktop();
  if (platform === "zhidao" && (!courseId || !/^[a-f0-9]{64}$/.test(courseId))) {
    throw new Error("INVALID_COURSE");
  }
  if (platform === "yuketang" && options && !validateOriginalOptions(options)) {
    throw new Error("INVALID_SETTINGS");
  }
  if (platform === "zhidao" && zhsOptions && !validateZhsOptions(zhsOptions)) {
    throw new Error("INVALID_SETTINGS");
  }
  return invoke<LegacyTaskStatus>("legacy_start", {
    platform,
    courseId: platform === "zhidao" ? courseId : null,
    // An explicit classroom override is allowed. Missing settings use a
    // conservative local 100% target, not the old global 90% default.
    options: platform === "yuketang"
      ? options ?? {...originalYktDefaults,completion_threshold:100}
      : null,
    zhsOptions: platform === "zhidao" ? zhsOptions ?? null : null,
  });
}

export async function stopLegacy(platform: Platform, expectedRunId:string): Promise<LegacyTaskStatus> {
  ensureDesktop();
  if(!expectedRunId)throw new Error("TASK_RUN_CHANGED");
  return invoke<LegacyTaskStatus>("legacy_stop", {platform,expectedRunId});
}

export function legacyError(err: unknown): string {
  const code = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  switch (code) {
    case "INVALID_COURSE": return "请先同步课程并选择有效的知到课程。";
    case "INVALID_SETTINGS": return "雨课堂原版参数超出支持范围。";
    case "TASK_RUN_CHANGED": return "运行任务已变化，请刷新状态后再操作。";
    case "TASK_ALREADY_RUNNING": return "该平台原版任务已在运行，请先停止后再启动。";
    case "LEGACY_NOT_INSTALLED": return "缺少学序本机执行器或原版知到运行环境。";
    case "LEGACY_LAUNCH_FAILED":
    case "TASK_START_FAILED":
    case "TASK_LAUNCH_FAILED": return "原版任务启动失败，请检查 Windows 运行环境。";
    case "TASK_STATUS_FAILED": return "无法读取运行任务状态，请重新查询。";
    case "TASK_STOP_FAILED": return "停止任务操作失败，请查询当前任务状态后重试。";
    case "TASK_STATE_UNAVAILABLE": return "无法获取本地任务状态。";
    case "RUN_NOT_AVAILABLE": return "网页版无法运行原版任务，请启动 Windows 桌面版。";
    default: return "原版任务操作失败，请检查安装与登录状态。";
  }
}

/** Bounded diagnostic descriptions; never render untrusted process stderr or tracebacks. */
export function zhsDiagnosticMessage(status: LegacyTaskStatus): string {
  if(status.platform!=="zhidao"||status.state!=="exited"||status.exit_code===0)return "";
  switch(status.diagnostic_code){
    case "CAPTCHA_REQUIRED": return "原版要求验证码，请使用平台官方交互完成验证后重新检查登录。";
    case "TIME_RESTRICTED": return "平台当前限制该资源的可用时间，请查看课程开放安排。";
    case "LOGIN_REQUIRED": return "原版登录会话失效，请在知到重新登录并同步课程。";
    case "NETWORK_ERROR": return "原版请求遭遇网络或服务端连接错误，请检查网络与平台状态。";
    case "LOCAL_FILE_MISSING": return "原版需要的本机文件未找到，请检查完整安装与本机数据。";
    case "FILE_PERMISSION_DENIED": return "原版访问本机文件被拒绝，请检查文件权限或安全软件。";
    case "INTERACTIVE_INPUT_REQUIRED": return "原版要求交互输入，无终端后台任务无法继续。";
    case "ZHS_SESSION_PREFLIGHT_FAILED": return "ZHS 会话预检未通过，请重新检查当前账号的登录状态。";
    case "ZHS_COOKIE_RESTORE_FAILED": return "ZHS 无法恢复本机登录凭证。请在学序完成知到扫码登录；检查用户目录下的 .zhs 配置与凭证是否可读取，无需先清除 Cookie。";
    case "ZHS_SESSION_EXPIRED": return "知到服务器判定当前 ZHS 会话已过期，请在学序重新扫码登录后再试。";
    case "ZHS_SESSION_UNAVAILABLE": return "知到服务器暂时无法完成会话核验，请检查网络或平台状态后重试；无需先删除登录数据。";
    case "ZHS_COURSE_URL_FAILED": return "ZHS 原版在课程链接处理阶段退出：请检查课程入口及课程类型是否与当前平台匹配。";
    case "UPSTREAM_NONZERO_EXIT": return "原版命令退出码非零，尚未识别出失败阶段；不能据此判断课程已开始播放。";
    case "EXECUTOR_EXCEPTION": return "原版执行器发生未分类异常，未记录敏感异常内容。";
    case "WORKER_ENTRY_EXCEPTION": return "任务入口发生未分类异常，请检查会话、课程数据及安装环境。";
    default: return "当前安装版本未提供可确认的错误分类；未保存原版隐私输出。";
  }
}

/** UI-safe explanation of the actual local process exit, not server progress. */
export function legacyExitMessage(status: LegacyTaskStatus): string {
  if (status.state !== "exited") return "";
  if (status.platform !== "zhidao") {
    if(status.exit_code===10)return "检测到已有雨课堂原版进程，已拒绝重复运行。";
    if(status.exit_code===11)return "雨课堂进程互斥锁不可用，已拒绝启动。";
    return status.exit_code === 0 ? "原版任务已结束；请核验平台记录。" :
      `原版任务已退出（代码 ${status.exit_code ?? "未知"}），请检查该平台登录与配置。`;
  }
  switch (status.exit_code) {
    case 0: return "ZHS 进程已正常退出；不代表服务器确认学习完成。";
    case 2: return "ZHS 启动参数无效，请重新同步并选择课程。";
    case 4: return "ZHS 登录会话或课程缓存不可用，请重新验证知到登录并同步课程。";
    case 5: return "未找到可用的 ZHS 0.1.5 运行时，请重新安装完整学序安装包。";
    case 6: return "所选课程不属于当前登录会话、已失效，或缺少有效课程路由，请重新同步课程。";
    case 9: return "原版 ZHS 要求交互输入，当前无终端模式无法继续；需在应用内处理该交互。";
    case 10: return "已有同平台的原版进程运行，已拒绝重复启动。";
    case 11: return "无法获取进程互斥锁，已拒绝启动以避免任务重复。";
    case 12: return "已达到设置的视频数量或任务时长上限；不代表服务器确认课程完成。";
    case 13: return "视频处理遇到错误，已按本次停止策略结束任务；请检查诊断信息。";
    case 14: return "指定的视频或知识点已不在当前真实课程目录中，请重新同步并选择。";
    case 1: return "ZHS 已启动但原版执行失败，请检查登录、课程状态及运行环境。";
    default: return `ZHS 意外退出（代码 ${status.exit_code ?? "未知"}），尚未确认执行成功。`;
  }
}
