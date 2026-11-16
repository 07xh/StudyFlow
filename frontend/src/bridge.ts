import {invoke} from "@tauri-apps/api/core";
import type {Platform, PlatformState, Course} from "./types";
import type {OriginalYktOptions,ZhsStoredOptions} from "./legacyPlayback";

export type Video = {id: string; name: string; chapter: string};
export type Config = {session_id: string; csrf_token: string; classroom_id: string; university_id: string; sign: string};
export type UCampusConfig = {variant:"ai"|"classic";catalog_url:string;cookie:string;authorization:string;annotator_token?:string;school_id?:string};
export type UCampusSessionInfo = {configured:boolean;variant:"ai"|"classic"|null};
export type UCampusLocalStatus={
  run_id:string;course_id:string;phase:string;active:boolean;paused:boolean;
  generated:number;sent:number;transport_accepted:number;server_confirmed:number|null;
  sender_connected:boolean;
  tasks:Array<{resource_id:string;chapter_id:string;title:string;state:string;
    generated:number;attempted:number;accepted:number;local_elapsed_seconds:number;server_completed:boolean|null}>;
};
export type UCampusUnit = {id:string;title:string;completed:boolean|null};
export type UCampusTask = {id:string;unit_id:string;title:string;type:string;required:boolean|null;completed:boolean|null};
export type YuketangScope = {classroom_id:string;university_id:string;has_session:boolean;has_sign:boolean};
export type YuketangSessionMarker = {marker:string};
export type BridgeRequest =
  | {id: string; version: 1; operation: "updates.latest"}
  | {id: string; version: 1; operation: "updates.settings.get"}
  | {id: string; version: 1; operation: "updates.settings.save"; settings: UpdateSettings}
  | {id: string; version: 1; operation: "updates.check"; current_version: string}
  | {id: string; version: 1; operation: "updates.download"; current_version: string; release_version: string}
  | {id: string; version: 1; operation: "updates.changelog"; current_version: string; previous_version?: string; history: boolean}
  | {id: string; version: 1; operation: "ping"}
  | {id: string; version: 1; operation: "platform.status"}
  | {id: string; version: 1; operation: "courses.list"; platform: Platform}
  | {id: string; version: 1; operation: "ucampus.units.list"; course_id: string}
  | {id: string; version: 1; operation: "ucampus.unit.tasks"; course_id: string; unit_id: string}
  | {id: string; version: 1; operation: "ucampus.heartbeat.capabilities"}
  | {id: string; version: 1; operation: "ucampus.heartbeat.start"; course_id: string; unit_id: string; pulses?: number}
  | {id: string; version: 1; operation: "ucampus.heartbeat.status"; course_id: string}
  | {id: string; version: 1; operation: "ucampus.heartbeat.pause" | "ucampus.heartbeat.resume" | "ucampus.heartbeat.stop"; course_id: string; run_id: string}
  | {id: string; version: 1; operation: "ucampus.session.info"}
  | {id: string; version: 1; operation: "ucampus.session.configure"; configuration: UCampusConfig}
  | {id: string; version: 1; operation: "ucampus.session.clear"}
  | {id: string; version: 1; operation: "xuexitong.session.configure"; cookie: string}
  | {id: string; version: 1; operation: "xuexitong.session.clear"}
  | {id: string; version: 1; operation: "xuexitong.settings.get"}
  | {id: string; version: 1; operation: "xuexitong.settings.save"; settings: XuexitongSettings}
  | {id: string; version: 1; operation: "xuexitong.chapter.tasks"; course_id: string; chapter_id: string}
  | {id: string; version: 1; operation: "xuexitong.chapters.list"; course_id: string}
  | {id: string; version: 1; operation: "videos.list"; platform: "yuketang"; course_id?: string}
  | {id: string; version: 1; operation: "yuketang.course.detail"; course_id: string; offset: number; limit: number}
  | {id: string; version: 1; operation: "yuketang.configure"; configuration: Config}
  | {id: string; version: 1; operation: "yuketang.scope.get"}
  | {id: string; version: 1; operation: "yuketang.session.marker"}
  | {id: string; version: 1; operation: "yuketang.scope.save"; scope: {classroom_id:string;university_id:string;sign?:string}}
  | {id: string; version: 1; operation: "yuketang.clear"}
  | {id: string; version: 1; operation: "yuketang.settings.get"}
  | {id: string; version: 1; operation: "yuketang.settings.save"; settings: OriginalYktOptions}
  | {id: string; version: 1; operation: "zhidao.zhs.settings.get"; course_key?:string}
  | {id: string; version: 1; operation: "zhidao.zhs.settings.save"; course_key?:string; settings: ZhsStoredOptions}
  | {id: string; version: 1; operation: "zhidao.cookie.import"; content: string; mode: "file" | "text"}
  | {id: string; version: 1; operation: "yuketang.progress"; run_id: string}
  | {id: string; version: 1; operation: "zhidao.progress.sync"}
  | {id: string; version: 1; operation: "zhidao.progress.verify"; course_key: string}
  | {id: string; version: 1; operation: "zhidao.player.target"; course_key: string}
  | {id: string; version: 1; operation: "zhidao.course.detail"; course_key: string}
  | {id: string; version: 1; operation: "zhidao.player.settings.get" | "zhidao.diagnose" | "zhidao.session.clear" | "zhidao.cache.clear"}
  | {id: string; version: 1; operation: "zhidao.player.settings.save"; settings: ZhidaoPlayerSettings}
  | {id: string; version: 1; operation: "zhidao.document.read"; document_id: "terms" | "privacy" | "license" | "source"}
  | {id: string; version: 1; operation: "studyflow.consent.status" | "studyflow.consent.accept"}
  | {id: string; version: 1; operation: "zhidao.qr.start" | "zhidao.qr.status" | "zhidao.qr.cancel"}
  | {id:string;version:1;operation:"xuexitong.heartbeat.start";course_id:string;
     speed?:number;jobs?:number;instant_complete?:boolean;settings?:XuexitongSettings;
     heartbeat_interval_video_seconds?:number;max_wall_seconds?:number;
     max_unconfirmed_rounds?:number;completion_rounds?:number;max_ticks?:number;
     dtype?:"Video"|"Audio"}
  | {id:string;version:1;operation:"xuexitong.heartbeat.status";course_id?:string}
  | {id:string;version:1;operation:"xuexitong.heartbeat.logs";limit?:number;course_id?:string}
  | {id:string;version:1;operation:"xuexitong.heartbeat.pause";run_id:string}
  | {id:string;version:1;operation:"xuexitong.heartbeat.resume";run_id:string}
  | {id:string;version:1;operation:"xuexitong.heartbeat.stop";run_id:string};

export type XuexitongSettings = {playback_speed:number;concurrency:number;skip_completed:boolean;verify_after_run:boolean};
export type HeartbeatTaskView={
  task_id:string;run_id:string;course_key:string;chapter:string;title:string;
  state:string;playing_time:number;duration:number;speed:number;
  last_send_state:string;sent_count:number;server_confirmed:boolean;
  server_play_time:number;end_reason:string;confirmed:boolean;resumable:boolean;
};
export type HeartbeatStatus={
  ok:boolean;running:boolean;paused:boolean;run_id:string;course_key:string;
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
export type XuexitongTaskItem = {id:string;type:string;title:string;chapter_id:string;completed:boolean|null};
export type ZhidaoProgressSnapshot = {courses:Course[];incomplete:boolean;fetched_at:string|null};
export type UpdateSettings = {channel:"stable"|"beta"; mode:"notify"|"download"};
export type AvailableUpdate = {version:string;notes:string;downloadable:boolean};
export type ReleaseChangelogEntry = {version:string;title:string;notes:string;published_at:string};
export type ZhidaoPlayerSettings = {speed:"1"|"1.25"|"1.5"|"2";allowMinimize:boolean;autoStart:boolean;autoNext:boolean;mode:"official"|"zhs-original"};
export type ZhidaoPlayerTarget = {course_key:string;course_type:"ai"|"shared";course_id:string;class_id:string;recruit_and_course_id:string;title:string};
export type ZhidaoDiagnostic = {code:number;state:string;lines:string[]};
export type ZhidaoDocument = {id:string;title:string;content:string};
export type YuketangVideoProgress = {
  id:string;name:string;chapter:string;
  progress_percent:number|null;server_completed:boolean|null;
  last_point_seconds:number|null;duration_seconds:number|null;
  verified_at:string|null;
};
export type YuketangCourseProgress = {
  course_id:string;offset:number;total:number;next_offset:number|null;
  items:YuketangVideoProgress[];
};
export type ZhidaoCourseDetail = {course_key:string;title:string;course_type:"ai"|"shared";verified:boolean;stale:boolean;verified_at:string|null;done:number;total:number;percent:number|null;items:Array<{name:string;theme?:string;knowledge_id?:number|null;video_id?:number|null;chapter_id?:number|null;chapter_name?:string;progress_percent?:number;fully_progressed?:boolean;duration_seconds?:number;studied_seconds?:number;server_completed?:boolean}>};

export type BridgeResponse<T> =
  | {id: string | null; ok: true; data: T}
  | {id: string | null; ok: false; error: string};

export interface StudyFlowTransport {
  request<T>(message: BridgeRequest): Promise<BridgeResponse<T>>;
}

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "id" | "version"> : never;
let serial = 0;
function nextId(): string {
  serial += 1;
  return "ui-" + Date.now().toString(36) + "-" + serial;
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" &&
    Boolean((window as Window & {__TAURI_INTERNALS__?: unknown}).__TAURI_INTERNALS__);
}

function classifyTauriInvokeError(value: unknown): string {
  const detail = typeof value === "string" ? value :
    value instanceof Error ? value.message :
    value && typeof value === "object" && "message" in value && typeof value.message === "string"
      ? value.message : "";
  if (detail.includes("Python learning service is missing")) return "BRIDGE_BINARY_MISSING";
  if (detail.includes("Could not start Python service")) return "BRIDGE_START_FAILED";
  if (detail.includes("Python service protocol error")) return "BRIDGE_PROTOCOL_FAILED";
  if (detail.includes("Python service returned an invalid response")) return "BRIDGE_RESPONSE_INVALID";
  if (detail.includes("Python service failed")) return "BRIDGE_PROCESS_FAILED";
  if (detail.includes("Resource directory unavailable")) return "BRIDGE_RESOURCE_DIR_FAILED";
  if (/bridge_request.*(not found|unknown|missing)/i.test(detail)) return "BRIDGE_COMMAND_UNAVAILABLE";
  if (detail.includes("Operation not permitted")) return "BRIDGE_COMMAND_REJECTED";
  return "BRIDGE_NOT_READY";
}

/** Real Tauri/sidecar interface only. A browser preview never simulates a local service. */
export function getStudyFlowTransport(): StudyFlowTransport | null {
  if (!isDesktop()) return null;
  return {
    async request<T>(message: BridgeRequest): Promise<BridgeResponse<T>> {
      try {
        return await invoke<BridgeResponse<T>>("bridge_request", {request: message});
      } catch (error) {
        throw new Error(classifyTauriInvokeError(error));
      }
    }
  };
}

async function checkedRequest<T>(transport: StudyFlowTransport, message: BridgeRequest): Promise<T> {
  const result = await transport.request<T>(message);
  if (!result || result.id !== message.id || typeof result.ok !== "boolean") {
    throw new Error("INVALID_IPC_RESPONSE");
  }
  if (!result.ok) {
    const allowed = new Set(["INVALID_UCAMPUS_CONFIG", "UCAMPUS_CREDENTIAL_STORAGE_FAILED", "XUEXITONG_TASK_STOP_TIMEOUT", "INVALID_XUEXITONG_COOKIE", "XUEXITONG_CREDENTIAL_STORAGE_FAILED", "INVALID_XUEXITONG_SETTINGS", "XUEXITONG_SETTINGS_UNAVAILABLE", "INVALID_REQUEST", "UNSUPPORTED_VERSION", "UNKNOWN_PLATFORM",
                             "PLATFORM_NOT_READY", "UNKNOWN_OPERATION", "CREDENTIAL_STORAGE_FAILED", "INVALID_YUKETANG_CONFIGURATION", "UPDATE_FAILED", "INVALID_UPDATE_SETTINGS",
                             "UPDATE_NETWORK_FAILED", "UPDATE_RATE_LIMITED", "UPDATE_RELEASE_INVALID", "UPDATE_ASSET_UNAVAILABLE",
                             "UPDATE_DOWNLOAD_FAILED", "UPDATE_CHECKSUM_FAILED", "UPDATE_STORAGE_FAILED", "UPDATE_REDIRECT_REJECTED",
                             "ZHIDAO_QR_UNAVAILABLE", "INVALID_COOKIE_IMPORT", "COOKIE_IMPORT_FAILED",
                             "YUKETANG_SETTINGS_UNAVAILABLE", "INVALID_YUKETANG_SETTINGS",
                             "ZHIDAO_PROGRESS_FAILED", "COURSE_NOT_FOUND", "COURSE_ROUTE_UNAVAILABLE",
                             "PLAYER_SETTINGS_UNAVAILABLE", "INVALID_PLAYER_SETTINGS", "ZHS_SETTINGS_UNAVAILABLE", "INVALID_ZHS_SETTINGS", "ZHIDAO_DIAGNOSE_FAILED",
                             "ZHIDAO_DATA_CLEAR_FAILED", "INVALID_DOCUMENT", "DOCUMENT_UNAVAILABLE", "CONSENT_STORAGE_FAILED",
                             "XUEXITONG_COURSE_REQUIRED", "XUEXITONG_TASK_ALREADY_RUNNING",
                             "XUEXITONG_INVALID_PARAMETER", "XUEXITONG_INVALID_TARGET",
                             "XUEXITONG_SESSION_MISSING", "XUEXITONG_INTERNAL_ERROR",
                             "XUEXITONG_UNKNOWN_OPERATION", "XUEXITONG_TASK_NOT_RUNNING",
                             "XUEXITONG_RUN_ID_MISMATCH", "XUEXITONG_NO_TARGET_FOR_DTYPE",
                             "XUEXITONG_NO_ACTIVE_TASK"]);
    throw new Error(allowed.has(result.error) ? result.error : "PLATFORM_NOT_READY");
  }
  return result.data;
}

export async function request<T>(message: WithoutEnvelope<BridgeRequest>): Promise<T> {
  const transport = getStudyFlowTransport();
  if (!transport) throw new Error("BRIDGE_NOT_READY");
  const full = {...message, id: nextId(), version: 1} as BridgeRequest;
  return checkedRequest<T>(transport, full);
}

function validPlatform(value: unknown): value is Platform {
  return value === "zhidao" || value === "yuketang" || value === "xuexitong" || value === "ucampus";
}

/** Can be unit-tested with a fake transport; production uses the real Tauri bridge. */
export async function fetchPlatformStatuses(transport: StudyFlowTransport): Promise<PlatformState[]> {
  const data = await checkedRequest<unknown>(transport, {id: nextId(), version: 1, operation: "platform.status"});
  if (!Array.isArray(data)) throw new Error("INVALID_IPC_RESPONSE");
  const result = new Map<Platform, PlatformState>();
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (!validPlatform(row.platform) || typeof row.connected !== "boolean") continue;
    result.set(row.platform, {
      platform: row.platform,
      status: row.connected ? "connected" : "not_connected",
      message: typeof row.message === "string" ? row.message.slice(0, 180) : "连接状态未确认",
      courses: [],
    });
  }
  if (result.size !== 4) throw new Error("INVALID_IPC_RESPONSE");
  return ["zhidao", "yuketang", "xuexitong", "ucampus"].map(p => result.get(p as Platform)!);
}

export async function fetchStatuses(): Promise<PlatformState[]> {
  const transport = getStudyFlowTransport();
  if (!transport) throw new Error("BRIDGE_NOT_READY");
  return fetchPlatformStatuses(transport);
}

export async function fetchCourses(transport: StudyFlowTransport, platform: Platform): Promise<Course[]> {
  const data = await checkedRequest<unknown>(transport, {id: nextId(), version: 1, operation: "courses.list", platform});
  if (!Array.isArray(data)) throw new Error("INVALID_IPC_RESPONSE");
  const result: Course[] = [];
  const seen = new Set<string>();
  for (const raw of data) {
    if (!raw || typeof raw !== "object") throw new Error("INVALID_IPC_RESPONSE");
    const row = raw as Record<string, unknown>;
    if (row.platform !== platform || typeof row.course_id !== "string" || !row.course_id.trim() ||
        typeof row.title !== "string" || !row.title.trim()) throw new Error("INVALID_IPC_RESPONSE");
    const id = row.course_id.slice(0, 128);
    if (seen.has(id)) continue;
    seen.add(id);
    const numeric = row.progress_percent;
    const progress = typeof numeric === "number" && Number.isFinite(numeric) && numeric >= 0 && numeric <= 100
      ? numeric : null;
    result.push({
      platform,
      course_id: id,
      title: row.title.slice(0, 250),
      progress_percent: progress,
      course_type: row.course_type === "ai" || row.course_type === "shared" ? row.course_type : null,
      stale: row.stale === true,
      progress_evidence: row.progress_evidence === "server_verified" ? "server_verified" : null,
      verified_at: typeof row.verified_at === "string" && row.verified_at.length <= 64 ? row.verified_at : null,
      session_marker: typeof row.session_marker === "string" && /^[a-f0-9]{64}$/.test(row.session_marker) ? row.session_marker : null,
      progress_metric: row.progress_metric === "official_ai_schedule" || row.progress_metric === "knowledge_point_full" || row.progress_metric === "completed_videos" ? row.progress_metric : null,
    });
  }
  return result;
}

export async function fetchCoursesFromDesktop(platform: Platform): Promise<Course[]> {
  const transport = getStudyFlowTransport();
  if (!transport) throw new Error("BRIDGE_NOT_READY");
  return fetchCourses(transport, platform);
}

/** Only allow fixed update error codes; never show raw network/IPC errors. */
export function friendlyUpdateError(value: unknown): string {
  const code = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  switch (code) {
    case "UPDATE_NETWORK_FAILED": return "无法连接 GitHub 更新接口，请检查网络或代理后重试。";
    case "UPDATE_RATE_LIMITED": return "GitHub 接口暂时限制访问，可稍后检查或从官方发布页下载。";
    case "UPDATE_RELEASE_INVALID": return "GitHub 发布元数据格式异常，未开始下载。";
    case "UPDATE_ASSET_UNAVAILABLE": return "此版本未提供带 SHA-256 校验信息的 Windows x64 安装包。";
    case "UPDATE_DOWNLOAD_FAILED": return "安装包下载失败或连接中断，请检查 GitHub Release 文件访问情况后重试。";
    case "UPDATE_CHECKSUM_FAILED": return "安装包 SHA-256 校验失败，未保存不可信安装包，请从官方发布页重新下载。";
    case "UPDATE_STORAGE_FAILED": return "无法写入学序更新目录，请检查磁盘空间和文件夹权限。";
    case "UPDATE_REDIRECT_REJECTED": return "下载地址跳转到未认可的网站，已中止以保护安装包安全。";
    case "BRIDGE_BINARY_MISSING":
    case "BRIDGE_START_FAILED":
    case "BRIDGE_PROTOCOL_FAILED":
    case "BRIDGE_PROCESS_FAILED":
    case "BRIDGE_NOT_READY":
    case "BRIDGE_RESPONSE_INVALID": return friendlyBridgeError(value);
    default: return "更新操作失败，原因暂未识别。可从学序 GitHub 官方发布页手动下载安装。";
  }
}

export function friendlyBridgeError(value: unknown): string {
  const code = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  switch (code) {
    case "BRIDGE_NOT_READY": return "学序 Windows IPC 服务不可用；请检查桌面版和 Python sidecar。";
    case "BRIDGE_BINARY_MISSING": return "安装包缺少 Python Sidecar（studyflow-bridge.exe）；请安装最新完整 Windows 安装包。";
    case "BRIDGE_START_FAILED": return "Python Sidecar 启动失败；请检查 Windows 安全软件是否隔离了 studyflow-bridge.exe。";
    case "BRIDGE_PROTOCOL_FAILED": return "Python Sidecar 已启动，但 JSONL 响应无效；请更新完整安装包。";
    case "BRIDGE_RESPONSE_INVALID": return "Python Sidecar 返回无效数据，本次读取已停止。";
    case "BRIDGE_PROCESS_FAILED": return "Python Sidecar 在处理请求时异常退出。";
    case "BRIDGE_RESOURCE_DIR_FAILED": return "学序安装资源目录无法定位，请重新安装完整版本。";
    case "BRIDGE_COMMAND_UNAVAILABLE": return "桌面端与前端版本不匹配，请重新安装同一版本。";
    case "BRIDGE_COMMAND_REJECTED": return "桌面端拒绝了此操作（IPC 白名单或参数不匹配），并非 Python sidecar 缺失；请更新学序。";
    case "UCAMPUS_COURSE_REQUIRED": return "请先选择 U校园真实课程。";
    case "UCAMPUS_INVALID_PARAMETER": return "本地心跳参数不符合要求。";
    case "UCAMPUS_INVALID_MEDIA_TASK": return "课程资源标识不正确。";
    case "UCAMPUS_NO_MEDIA_TASKS": return "本单元没有可识别的待学习视频或音频资源。";
    case "UCAMPUS_TASK_ALREADY_RUNNING": return "当前已有 U校园本地运行任务。";
    case "UCAMPUS_TASK_NOT_RUNNING": return "当前没有正在运行的 U校园本地任务。";
    case "UCAMPUS_RUN_ID_MISMATCH": return "运行 ID 或课程不匹配，请刷新。";
    case "UCAMPUS_RUNTIME_UNAVAILABLE": return "U校园本地任务服务不可用。";
    case "UCAMPUS_OPEN_ID_REQUIRED": return "当前 U校园会话缺少可核验的 openId，无法读取单元与任务。请重新登录或更新本机会话。";
    case "UCAMPUS_AI_ONLY": return "目前单元与任务读取仅支持 U校园5.0 AI版。";
    case "UCAMPUS_SESSION_MISSING": return "请先配置 U校园登录会话。";
    case "UCAMPUS_SESSION_EXPIRED": return "U校园会话已失效，请重新登录。";
    case "UCAMPUS_PROGRESS_FORMAT_UNVERIFIED": return "U校园返回的数据结构与已知开源接口不一致，未推断任何进度。";
    case "UCAMPUS_PROGRESS_UNAVAILABLE": return "U校园单元/任务进度接口请求失败，请检查账号、网络和课程。";
    case "INVALID_UCAMPUS_CONFIG": return "U校园配置不符合要求：仅支持官方 HTTPS 域名与正确格式的登录会话。";
    case "UCAMPUS_CREDENTIAL_STORAGE_FAILED": return "U校园登录信息未能写入 Windows 凭据管理器。";
    case "XUEXITONG_TASK_STOP_TIMEOUT": return "学习通任务尚未安全停止，请稍后重试退出或切换账号。";
    case "INVALID_XUEXITONG_SETTINGS": return "学习通参数超出允许范围，原设置未修改。";
    case "XUEXITONG_SETTINGS_UNAVAILABLE": return "学习通本机设置保存失败，请检查本地文件权限。";
    case "INVALID_XUEXITONG_COOKIE": return "学习通登录会话格式不正确，请确认包含有效的 _uid/UID。";
    case "XUEXITONG_CREDENTIAL_STORAGE_FAILED": return "学习通登录会话未能写入 Windows 凭据管理器。";
    case "INVALID_IPC_RESPONSE": return "本机数据响应不符合协议，课程未加载。";
    case "PLATFORM_NOT_READY": return "真实平台课程读取失败；请检查账号、网络和原版运行时。";
    case "CREDENTIAL_STORAGE_FAILED": return "Windows 凭据管理器保存失败。";
    case "INVALID_YUKETANG_CONFIGURATION": return "雨课堂配置格式无效：请核对 Session ID、CSRF Token，并确保课堂 ID 和学校 ID 均为 1–24 位数字。";
    case "YUKETANG_SETTINGS_UNAVAILABLE": return "原版雨课堂配置未能读取或保存；旧配置未被覆盖。";
    case "INVALID_YUKETANG_SETTINGS": return "雨课堂参数不符合原版可用范围，未保存。";
    case "UNSUPPORTED_VERSION": return "桌面端与数据服务协议版本不一致。";
    case "UNKNOWN_PLATFORM": return "不支持该学习平台。";
    case "INVALID_REQUEST": return "本机请求格式有误。";
    case "ZHIDAO_QR_UNAVAILABLE": return "知到扫码服务尚不可用，检查原版安装与网络。";
    case "INVALID_COOKIE_IMPORT": return "Cookie 内容为空、格式不正确或超过原版支持的大小。";
    case "ZHIDAO_PROGRESS_FAILED": return "知到服务器进度读取失败；旧记录保持不变。";
    case "COURSE_NOT_FOUND": return "当前登录会话中找不到这门课程，请先重新同步课程。";
    case "COURSE_ROUTE_UNAVAILABLE": return "当前课程缺少原版播放器需要的安全路由信息，请重新同步课程。";
    case "PLAYER_SETTINGS_UNAVAILABLE": return "知到播放器设置读取或保存失败，旧设置保持不变。";
    case "INVALID_PLAYER_SETTINGS": return "知到播放器参数无效，未保存。";
    case "ZHS_SETTINGS_UNAVAILABLE": return "ZHS 参数读取或保存失败，原版设置未修改。";
    case "INVALID_ZHS_SETTINGS": return "ZHS 参数超出原版支持范围，未保存。";
    case "ZHIDAO_DIAGNOSE_FAILED": return "知到连接诊断未能完成。";
    case "ZHIDAO_DATA_CLEAR_FAILED": return "知到本地数据清理失败；未删除未列入清单的数据。";
    case "INVALID_DOCUMENT": return "请求的说明文档不存在。";
    case "DOCUMENT_UNAVAILABLE": return "说明文档暂不可读取。";
    case "CONSENT_STORAGE_FAILED": return "首次使用声明状态无法保存，请检查本机应用数据目录。";
    case "XUEXITONG_COURSE_REQUIRED": return "请先选择课程再启动本地心跳任务。";
    case "XUEXITONG_TASK_ALREADY_RUNNING": return "已有心跳任务在运行，请先停止。";
    case "XUEXITONG_INVALID_PARAMETER": return "心跳参数无效，检查速度与并发范围。";
    case "XUEXITONG_INVALID_TARGET": return "任务点信息不完整，请重新读取章节任务。";
    case "XUEXITONG_SESSION_MISSING": return "学习通会话未配置，请先登录。";
    case "XUEXITONG_TASK_NOT_RUNNING": return "当前没有运行中的心跳任务。";
  case "XUEXITONG_NO_ACTIVE_TASK": return "当前账号或课程下没有活动心跳任务，请先启动。";
    case "XUEXITONG_RUN_ID_REQUIRED": return "当前任务缺少运行 ID，请刷新课程状态后重试。";
    case "XUEXITONG_RUN_ID_MISMATCH": return "运行 ID 不匹配，请刷新状态后重试。";
    case "XUEXITONG_INTERNAL_ERROR": return "本地心跳服务内部错误，请查看运行日志。";
    case "XUEXITONG_UNKNOWN_OPERATION": return "不支持的心跳操作。";
    case "XUEXITONG_NO_TARGET_FOR_DTYPE": return "所选任务类型下没有可运行的任务点。";
    case "COOKIE_IMPORT_FAILED": return "原版 Cookie 导入组件启动失败或无法完成服务器核验。";
    default: return "本机服务调用失败，请检查运行环境。";
  }
}

export async function openLegacyZhidao(): Promise<void> {
  if (!isDesktop()) throw new Error("BRIDGE_NOT_READY");
  try { await invoke("launch_zhidao_legacy"); }
  catch { throw new Error("LEGACY_NOT_AVAILABLE"); }
}

/** Ephemeral QR image, never saved to localStorage or a log. */
export type ZhidaoQrStage = "idle" | "busy" | "requesting" | "ready" | "scanned" |
  "confirming" | "verified" | "unavailable" | "rejected" | "expired" |
  "cancelled" | "failed" | "environment-error";
export type ZhidaoQrState = {stage:ZhidaoQrStage;image_png_base64?:string|null};
export function zhidaoQrCommand(action:"start"|"status"|"cancel"):Promise<ZhidaoQrState>{
  const operation = ({start:"zhidao.qr.start",status:"zhidao.qr.status",
    cancel:"zhidao.qr.cancel"} as const)[action];
  return request<ZhidaoQrState>({operation});
}
