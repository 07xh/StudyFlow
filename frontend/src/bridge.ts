import {invoke} from "@tauri-apps/api/core";
import type {Platform, PlatformState, Course} from "./types";
import type {OriginalYktOptions,ZhsStoredOptions} from "./legacyPlayback";

export type Video = {id: string; name: string; chapter: string};
export type Config = {session_id: string; csrf_token: string; classroom_id: string; university_id: string; sign: string};
export type UCampusConfig = {variant:"ai"|"classic";catalog_url:string;cookie:string;authorization:string;annotator_token?:string;school_id?:string};
export type UCampusSessionInfo = {configured:boolean;variant:"ai"|"classic"|null;jwt_lifetime?:"expired"|"expiring"|"not_expired"|"unknown"};
export type UCampusSocketDiagnostic={
  transport:"legacy_socketio_v3";handshake:"namespace_joined";
  learning_events_sent:0;progress_verified:false;ai5_compatible:null;
};
export type UCampusFabricatedStatus={
  run_id:string;course_id:string;unit_id:string;phase:string;active:boolean;paused:boolean;
  generated:number;sent:number;transport_accepted:number;server_confirmed:number;
  completed:number;reported:number;sender_connected:boolean;last_error:string;
  progress_causality:"unverified";source_kind:"synthetic_activity";
  restart_resume_supported:boolean;snapshot_store_configured:boolean;
  tasks:Array<{resource_id:string;title:string;dtype:string;duration_seconds:number;
    state:string;generated:number;sent:number;accepted:number;confirmed:number;
    position_seconds:number;server_completed:boolean|null;last_error:string}>;
};
export type UCampusFabricatedHistory={
  records:Array<{run_id:string;course_id:string;unit_id:string;phase:string;
    resources:number;generated:number;sent:number;server_readback_passed:number;
    resume_available:false;progress_causality:"unverified"}>;
  resume_available:false;
};
export type UCampusFabricatedCapabilities={
  ok:boolean;local_generation:boolean;socket_transport_available:boolean;
  session_configured:boolean;official_player_required:boolean;
  activity_heartbeat:string;completion_packet:string;server_readback:string;message:string;
};
export type UCampusVerifiedProgress={
  course_id:string;unit_id:string;verified_at:string;
  total:number;passed:number;not_passed:number;unknown:number;
  required_total:number;required_passed:number;
  tasks:Array<{id:string;type:string;required:boolean|null;completed:boolean|null}>;
};
export type UCampusMonitorStatus={
  enabled:boolean;course_id:string;unit_id:string;
  state:string;checked_at:string;total:number;passed:number;unknown:number
};
export type UCampusUnit = {id:string;title:string;completed:boolean|null};
export type UCampusTask = {id:string;unit_id:string;title:string;type:string;required:boolean|null;completed:boolean|null};
export type YuketangScope = {classroom_id:string;university_id:string;has_session:boolean;has_sign:boolean};
export type YuketangSessionMarker = {marker:string};
export type BridgeRequest =
  | {id: string; version: 1; operation: "updates.latest" | "updates.sources"}
  | {id: string; version: 1; operation: "updates.settings.get"}
  | {id: string; version: 1; operation: "updates.settings.save"; settings: UpdateSettings}
  | {id: string; version: 1; operation: "updates.check"; current_version: string}
  | {id: string; version: 1; operation: "updates.download"; current_version: string; release_version: string}
  | {id: string; version: 1; operation: "updates.changelog"; current_version: string; previous_version?: string; history: boolean}
  | {id: string; version: 1; operation: "questionbank.providers" | "questionbank.tokens.list"}
  | {id: string; version: 1; operation: "questionbank.tokens.add"; provider_id:string; label:string; token:string}
  | {id: string; version: 1; operation: "questionbank.tokens.import"; provider_id:string; lines:string}
  | {id: string; version: 1; operation: "questionbank.tokens.rotation"; provider_id:string; mode:"fixed"|"round_robin"}
  | {id: string; version: 1; operation: "questionbank.tokens.check"; token_id:string; include_quota:boolean}
  | {id: string; version: 1; operation: "questionbank.tokens.select" | "questionbank.tokens.remove"; token_id:string}
  | {id: string; version: 1; operation: "questionbank.query"; provider_id:string; question:QuestionBankQuestion; token_id?:string}
  | {id: string; version: 1; operation: "ping"}
  | {id: string; version: 1; operation: "platform.status"}
  | {id: string; version: 1; operation: "courses.list"; platform: Platform}
  | {id: string; version: 1; operation: "ucampus.units.list"; course_id: string}
  | {id: string; version: 1; operation: "ucampus.unit.tasks"; course_id: string; unit_id: string}
  | {id: string; version: 1; operation: "ucampus.progress.verify"; course_id: string; unit_id: string}
  | {id: string; version: 1; operation: "ucampus.monitor.status" | "ucampus.monitor.tick"}
  | {id: string; version: 1; operation: "ucampus.monitor.configure"; enabled: boolean; course_id?: string; unit_id?: string}
  | {id: string; version: 1; operation: "ucampus.socket.diagnose"}
  | {id: string; version: 1; operation: "ucampus.fabricated.capabilities"}
  | {id: string; version: 1; operation: "ucampus.fabricated.start"; course_id: string; unit_id: string; pulses?: number; speed?: number; duration_seconds?: number; heartbeat_interval?: number; instant_complete?: boolean}
  | {id: string; version: 1; operation: "ucampus.fabricated.status"; course_id: string}
  | {id: string; version: 1; operation: "ucampus.fabricated.history"; course_id: string}
  | {id: string; version: 1; operation: "ucampus.fabricated.pause" | "ucampus.fabricated.resume" | "ucampus.fabricated.stop"; course_id: string; run_id: string}
  | {id: string; version: 1; operation: "ucampus.session.info"}
  | {id: string; version: 1; operation: "ucampus.session.configure"; configuration: UCampusConfig}
  | {id: string; version: 1; operation: "ucampus.session.login"; username: string; password: string}
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
  | {id: string; version: 1; operation: "zhidao.zhs.knowledge.detail"; course_key: string; knowledge_id: string}
  | {id: string; version: 1; operation: "zhidao.player.settings.get" | "zhidao.diagnose" | "zhidao.session.clear" | "zhidao.cache.clear"}
  | {id: string; version: 1; operation: "zhidao.player.settings.save"; settings: ZhidaoPlayerSettings}
  | {id: string; version: 1; operation: "zhidao.document.read"; document_id: "terms" | "privacy" | "license" | "source"}
  | {id: string; version: 1; operation: "zhidao.mastery.catalog"; course_key: string; with_mastery?: boolean; force_refresh?: boolean}
  | {id: string; version: 1; operation: "zhidao.mastery.auto.start"; course_key: string; settings: MasteryAutoSettings}
  | {id: string; version: 1; operation: "zhidao.mastery.auto.status"; course_key: string}
  | {id: string; version: 1; operation: "zhidao.mastery.auto.control"; course_key: string; action: "pause"|"resume"|"stop"}
  | {id: string; version: 1; operation: "zhidao.mastery.round.start"; course_key: string; knowledge_id: string}
  | {id: string; version: 1; operation: "zhidao.mastery.round.active"; course_key: string; knowledge_id: string}
  | {id: string; version: 1; operation: "zhidao.mastery.round.answer"; course_key: string; knowledge_id: string; question_id: string; answer: string | number | Array<string | number>}
  | {id: string; version: 1; operation: "zhidao.mastery.round.submit"; course_key: string; knowledge_id: string}
  | {id: string; version: 1; operation: "zhidao.mastery.round.discard"; course_key: string; knowledge_id: string}
  | {id: string; version: 1; operation: "zhidao.mastery.wrong"; course_key: string; knowledge_id: string; exam_test_id?: string}
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
  task_id:string;run_id:string;course_key:string;chapter_id?:string;chapter:string;title:string;
  state:string;playing_time:number;duration:number;speed:number;
  last_send_state:string;sent_count:number;server_confirmed:boolean;
  server_play_time:number;end_reason:string;confirmed:boolean;resumable:boolean;
};
export type HeartbeatStatus={
  ok:boolean;running:boolean;paused:boolean;run_id:string;course_key:string;
  config:{speed:number;jobs:number;instant_complete:boolean;randomize_interval:boolean};
  task_count:number;tasks:HeartbeatTaskView[];
  queue?:{total_chapters:number;active_chapters:number;paused_chapters:number;
    queued_chapters:number;pending_tasks:number;running_tasks:number}|null;
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
export type UpdateSettings = {channel:"stable"|"beta"; mode:"notify"|"download"; source:"auto"|"github"|"proxy"; fallback:boolean};
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
export type ZhsKnowledgeDetail = {
  course_key:string;knowledge_id:string;name:string;content:string;
  content_available:boolean;detail_metadata_present:boolean;
  listed_resource_count:number;official_resource_count:number|null;
  official_finished_resource_count:number|null;catalog_mismatch:boolean;
  catalog_source:"desktop"|"mobile"|null;detail_source:"desktop"|"mobile";
  mobile_knowledge_progress_percent:number|null;
  knowledge_progress_percent:number;progress_sources_disagree:boolean;
  verification:"read_only";
  verified_at:string;study_record_submitted:false;
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
                             "UPDATE_DOWNLOAD_FAILED", "UPDATE_CHECKSUM_FAILED", "UPDATE_STORAGE_FAILED", "UPDATE_REDIRECT_REJECTED", "UPDATE_MIRROR_UNAVAILABLE",
                             "ZHIDAO_QR_UNAVAILABLE", "INVALID_COOKIE_IMPORT", "COOKIE_IMPORT_FAILED",
                             "YUKETANG_SETTINGS_UNAVAILABLE", "INVALID_YUKETANG_SETTINGS",
                             "ZHIDAO_PROGRESS_FAILED", "COURSE_NOT_FOUND", "COURSE_ROUTE_UNAVAILABLE",
                             "PLAYER_SETTINGS_UNAVAILABLE", "INVALID_PLAYER_SETTINGS", "ZHS_SETTINGS_UNAVAILABLE", "INVALID_ZHS_SETTINGS", "ZHS_DETAIL_UNAVAILABLE", "ZHS_DETAIL_RESOURCES_UNCONFIRMED", "KNOWLEDGE_NOT_FOUND", "ZHIDAO_DIAGNOSE_FAILED",
                             "LOGIN_REQUIRED", "LOGIN_UNCONFIRMED", "LOGIN_CHECK_UNAVAILABLE", "NOT_AI_COURSE", "MASTERY_UNAVAILABLE", "PAPER_UNAVAILABLE", "PAPER_EMPTY",
                             "NO_ACTIVE_ROUND", "ROUND_EXPIRED", "QUESTION_NOT_IN_ROUND", "EMPTY_ANSWER",
                             "ANSWER_SAVE_FAILED", "SUBMIT_FAILED", "SUBMIT_IN_PROGRESS", "SUBMIT_STATUS_UNKNOWN", "ROUND_ALREADY_SUBMITTED", "ZHS_MASTERY_UNAVAILABLE", "MASTERY_AUTO_RUNNING", "MASTERY_AUTO_NOT_RUNNING", "AI_KEY_REQUIRED",
                             "ZHIDAO_DATA_CLEAR_FAILED", "INVALID_DOCUMENT", "DOCUMENT_UNAVAILABLE", "CONSENT_STORAGE_FAILED",
                             "XUEXITONG_COURSE_REQUIRED", "XUEXITONG_TASK_ALREADY_RUNNING",
                             "XUEXITONG_INVALID_PARAMETER", "XUEXITONG_INVALID_TARGET",
                             "XUEXITONG_SESSION_MISSING", "XUEXITONG_INTERNAL_ERROR",
                             "XUEXITONG_UNKNOWN_OPERATION", "XUEXITONG_TASK_NOT_RUNNING",
                             "XUEXITONG_RUN_ID_MISMATCH", "XUEXITONG_NO_TARGET_FOR_DTYPE",
                             "XUEXITONG_NO_ACTIVE_TASK",
                             "UCAMPUS_COURSE_REQUIRED", "UCAMPUS_INVALID_PARAMETER",
                             "UCAMPUS_INVALID_MEDIA_TASK", "UCAMPUS_NO_MEDIA_TASKS",
                             "UCAMPUS_TASK_ALREADY_RUNNING", "UCAMPUS_TASK_NOT_RUNNING",
                             "UCAMPUS_RUN_ID_MISMATCH", "UCAMPUS_RUNTIME_UNAVAILABLE",
                             "UCAMPUS_SESSION_MISSING", "UCAMPUS_SESSION_EXPIRED",
                              "INVALID_UCAMPUS_LOGIN", "UCAMPUS_LOGIN_UNAVAILABLE", "UCAMPUS_LOGIN_REJECTED",
                              "UCAMPUS_LOGIN_FORMAT_UNVERIFIED", "UCAMPUS_LOGIN_VERIFICATION_REQUIRED", "UCAMPUS_LOGIN_RATE_LIMITED",
                              "UCAMPUS_CATALOG_UNAVAILABLE", "UCAMPUS_CATALOG_FORMAT_UNVERIFIED",
                              "UCAMPUS_MONITOR_STORAGE_FAILED", "UCAMPUS_MONITOR_UNAVAILABLE",
                             "UCAMPUS_AI_ONLY", "UCAMPUS_OPEN_ID_REQUIRED",
                             "UCAMPUS_PROGRESS_UNAVAILABLE", "UCAMPUS_PROGRESS_FORMAT_UNVERIFIED",
                             "UCAMPUS_INVALID_FABRICATED_PARAMETER", "UCAMPUS_INVALID_FABRICATED_TARGET",
                             "UCAMPUS_INVALID_FABRICATED_PAYLOAD", "UCAMPUS_INVALID_FABRICATED_SEQUENCE",
                             "UCAMPUS_RATE_LIMITED", "UCAMPUS_SUBMIT_REJECTED",
                             "UCAMPUS_SUBMIT_UNVERIFIED", "UCAMPUS_SEND_UNAVAILABLE",
                             "UCAMPUS_SENDER_UNAVAILABLE", "UCAMPUS_RUN_FAILED",
                             "UCAMPUS_CLEANUP_FAILED"]);
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
    case "UPDATE_DOWNLOAD_FAILED": return "所有已启用下载源均下载失败，断点数据已保留，可稍后重试。";
    case "UPDATE_MIRROR_UNAVAILABLE": return "公共代理无法使用，请选 GitHub 官方源或打开失败自动切换。";
    case "UPDATE_CHECKSUM_FAILED": return "安装包 SHA-256 校验失败，未保存不可信安装包，请从官方发布页重新下载。";
    case "UPDATE_STORAGE_FAILED": return "无法写入学序更新目录，请检查磁盘空间和文件夹权限。";
    case "UPDATE_REDIRECT_REJECTED": return "下载地址跳转到未认可的网站，已中止以保护安装包安全。";
    case "BRIDGE_NOT_READY":
    case "BRIDGE_RESPONSE_INVALID": return friendlyBridgeError(value);
    default:
      if (code.startsWith("BRIDGE_") || code.startsWith("QUESTIONBANK_") || code.startsWith("YANXI_"))
        return friendlyBridgeError(value);
      return "更新操作失败，原因暂未识别。可从学序 GitHub 官方发布页手动下载安装。";
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
    case "QUESTIONBANK_UNKNOWN_PROVIDER": return "该题库尚未接入学序，请在设置里选择已支持的题库。";
    case "QUESTIONBANK_INVALID_TOKEN": return "Token 内容不符合所选题库的格式要求。";
    case "QUESTIONBANK_INVALID_LABEL": return "Token 备注须为 1 至 50 个字符。";
    case "QUESTIONBANK_INVALID_TOKEN_ID": return "Token 标识无效，请重新加载题库列表。";
    case "QUESTIONBANK_TOKEN_NOT_FOUND": return "没有找到选中的 Token，请在题库设置里重新选择。";
    case "QUESTIONBANK_TOKEN_LIMIT": return "同一题库最多保存 100 条 Token。";
    case "QUESTIONBANK_INVALID_BATCH": return "请每行粘贴一条 Token，最多 100 行，且不能包含无效字符。";
    case "QUESTIONBANK_INVALID_ROTATION": return "请选择固定使用或轮流使用模式。";
    case "QUESTIONBANK_CHECK_UNSUPPORTED": return "当前题库没有可用的 Token 状态检测接口。";
    case "QUESTIONBANK_TOKEN_DUPLICATE": return "这条 Token 已存在于当前题库。";
    case "QUESTIONBANK_INVALID_QUESTION": return "题目数据不符合要求，请检查题干、题型和选项。";
    case "QUESTIONBANK_BAD_RESPONSE": return "题库提供方返回的数据格式不符合要求，本次结果未被采用。";
    case "QUESTIONBANK_STORAGE_FAILED": return "本机题库 Token 保险库不可读，请检查 Windows 用户权限和旧 Token。";
    case "QUESTIONBANK_UNAVAILABLE": return "共享题库服务不可用，请检查桌面版安装包。";
    case "YANXI_WINDOWS_ONLY": return "言溪本地 Token 存储仅支持 Windows EXE。";
    case "YANXI_INVALID_TOKEN": return "言溪 Token 格式不正确，请检查后重新输入。";
    case "YANXI_TOKEN_STORAGE_FAILED": return "无法读取或保存本机加密 Token，请重新配置。";
    case "YANXI_NOT_CONFIGURED": return "请先配置言溪题库 Token。";
    case "YANXI_INVALID_QUERY": return "请输入有效的题目内容，单题不超过 4000 字。";
    case "YANXI_QUOTA_EXHAUSTED": return "言溪 Token 查询次数不足，请查看言溪控制台。";
    case "YANXI_TOKEN_REJECTED": return "言溪服务端未接受 Token，请核对 Token 和权限。";
    case "YANXI_RATE_LIMITED": return "言溪服务限制了查询频率，请稍后手动重试。";
    case "YANXI_REDIRECT_BLOCKED": return "言溪接口发生重定向，为保护 Token 已拒绝转发。";
    case "YANXI_NETWORK_FAILED": return "连接言溪题库失败，请检查网络。";
    case "YANXI_BAD_RESPONSE": return "言溪接口响应格式异常，未采用该结果。";
    case "YANXI_UPSTREAM_UNAVAILABLE": return "言溪查询服务暂时不可用。";
    case "UCAMPUS_SOCKET_TOKEN_REQUIRED": return "请先在 U校园账号设置中填写本人会话的内容授权令牌。";
    case "UCAMPUS_SOCKET_HANDSHAKE_UNVERIFIED": return "旧版 WebSocket 握手未通过，当前接口可能不兼容 U校园5.0。";
    case "UCAMPUS_SOCKET_NAMESPACE_UNVERIFIED": return "旧版 Socket.IO 命名空间认证未通过。";
    case "UCAMPUS_SOCKET_TRANSPORT_UNKNOWN": return "U校园 WebSocket 连接失败或超时，请检查网络和本机会话。";
    case "UCAMPUS_SOCKET_BAD_FRAME": return "U校园 WebSocket 返回了无法识别的数据。";
    case "UCAMPUS_SOCKET_NO_ACK": return "U校园 WebSocket 未按预期响应。";
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
    case "UCAMPUS_SESSION_EXPIRED": return "U校园 JWT 自报已过期，或课程接口拒绝了当前登录会话。请重新完成官方登录并导入最新会话。";
    case "UCAMPUS_CONTENT_AUTH_REJECTED": return "课程登录不一定失效：U校园内容进度接口未接受当前内容侧认证（HTTP 401）。请在账号与连接中重新验证；若课程可读，核对内容授权令牌，不要反复重登。";
    case "UCAMPUS_CONTENT_ACCESS_DENIED": return "课程登录不一定失效：U校园内容进度接口拒绝访问（HTTP 403），可能是课程权限或内容侧认证要求。请确认本人在官网能进入该课程单元。";
    case "UCAMPUS_MONITOR_STORAGE_FAILED": return "U校园断点核验记录保存失败，请检查本机权限与存储空间。";
    case "UCAMPUS_MONITOR_UNAVAILABLE": return "U校园进度核验任务暂不可用。";
    case "INVALID_UCAMPUS_LOGIN": return "请输入有效的 U校园账号和密码。";
    case "UCAMPUS_LOGIN_UNAVAILABLE": return "U校园 SSO 登录接口请求失败，请检查网络或稍后再试。";
    case "UCAMPUS_LOGIN_REJECTED": return "U校园未接受本次登录，请检查账号密码及平台账号状态。";
    case "UCAMPUS_LOGIN_FORMAT_UNVERIFIED": return "U校园 SSO 返回的数据结构与当前适配器不一致，未保存会话。";
    case "UCAMPUS_LOGIN_VERIFICATION_REQUIRED": return "U校园要求图片或数字验证码，请在官方登录窗口查看并手动填写。学序不会自动识别或绕过验证码。";
    case "UCAMPUS_LOGIN_RATE_LIMITED": return "U校园限制了本次登录请求，请遵循平台提示后再试。";
    case "UCAMPUS_CATALOG_UNAVAILABLE": return "U校园课程接口请求失败，请检查网络、账号与接口版本。";
    case "UCAMPUS_CATALOG_FORMAT_UNVERIFIED": return "U校园课程接口返回了未知数据格式；未生成任何模拟课程，请核验平台版本。";
    case "UCAMPUS_PROGRESS_FORMAT_UNVERIFIED": return "U校园返回的数据结构与已知开源接口不一致，未推断任何进度。";
    case "UCAMPUS_PROGRESS_UNAVAILABLE": return "U校园单元/任务进度接口请求失败，请检查账号、网络和课程。";
    case "INVALID_UCAMPUS_CONFIG": return "U校园配置不符合要求：仅支持官方 HTTPS 域名与正确格式的登录会话。";
    case "UCAMPUS_CREDENTIAL_STORAGE_FAILED": return "U校园本机加密会话无法读取或保存，请检查用户目录权限。";
    case "UCAMPUS_INVALID_FABRICATED_PARAMETER": return "虚构心跳参数超出允许范围。";
    case "UCAMPUS_INVALID_FABRICATED_TARGET": return "课程资源标识校验失败，已停止发送。";
    case "UCAMPUS_INVALID_FABRICATED_PAYLOAD": return "虚构心跳包字段校验失败，已停止发送。";
    case "UCAMPUS_INVALID_FABRICATED_SEQUENCE": return "虚构心跳序号不合法。";
    case "UCAMPUS_RATE_LIMITED": return "U校园提示操作过于频繁，已按上游冷却策略重试。";
    case "UCAMPUS_SUBMIT_REJECTED": return "U校园拒绝了完成申报，本次未记为通过。";
    case "UCAMPUS_SUBMIT_UNVERIFIED": return "完成申报返回了无法核验的结果，本次未记为通过。";
    case "UCAMPUS_SEND_UNAVAILABLE": return "无法连接 U校园提交接口，请检查网络与本机会话。";
    case "UCAMPUS_SENDER_UNAVAILABLE": return "虚构心跳发送器未就绪，请重新配置会话。";
    case "UCAMPUS_RUN_FAILED": return "本机任务运行异常，已隐藏可能包含会话信息的错误详情。";
    case "UCAMPUS_CLEANUP_FAILED": return "任务结束时关闭通信连接失败，未将其视为平台完成证明。";
    case "XUEXITONG_TASK_STOP_TIMEOUT": return "学习通任务尚未安全停止，请稍后重试退出或切换账号。";
    case "INVALID_XUEXITONG_SETTINGS": return "学习通参数超出允许范围，原设置未修改。";
    case "XUEXITONG_SETTINGS_UNAVAILABLE": return "学习通本机设置保存失败，请检查本地文件权限。";
    case "INVALID_XUEXITONG_COOKIE": return "学习通登录会话格式不正确，请确认包含有效的 _uid/UID。";
    case "XUEXITONG_CREDENTIAL_STORAGE_FAILED": return "学习通本机加密会话无法读取或保存，请检查用户目录权限。";
    case "INVALID_IPC_RESPONSE": return "本机数据响应不符合协议，课程未加载。";
    case "PLATFORM_NOT_READY": return "真实平台课程读取失败；请检查账号、网络和原版运行时。";
    case "CREDENTIAL_STORAGE_FAILED": return "本机加密登录凭据无法读取或保存，请检查用户目录权限。";
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
    case "LOGIN_REQUIRED": return "本机没有知到登录凭证，请在知到账户页扫码登录。";
    case "LOGIN_UNCONFIRMED": return "知到登录状态尚未确认：可能是网络、CAS 服务或会话过期，请先检查连接状态。";
    case "LOGIN_CHECK_UNAVAILABLE": return "知到会话检测运行失败，无法确认是否已登录；无需立即重复扫码。";
    case "NOT_AI_COURSE": return "只有 AI 课程的知识点有掌握度习题。";
    case "MASTERY_UNAVAILABLE": return "该知识点的掌握度暂时读不到。";
    case "PAPER_UNAVAILABLE": return "服务器没有返回可作答的练习卷。";
    case "PAPER_EMPTY": return "本轮练习没有题目。";
    case "NO_ACTIVE_ROUND": return "当前没有进行中的一轮，请先开始练习。";
    case "ROUND_EXPIRED": return "这一轮已超时，重新开始即可。";
    case "QUESTION_NOT_IN_ROUND": return "这道题不属于当前这一轮。";
    case "EMPTY_ANSWER": return "请先选择或填写答案。";
    case "ANSWER_SAVE_FAILED": return "这一题没保存成功，可以重试。";
    case "SUBMIT_FAILED": return "提交失败，请核对服务器状态。";
    case "SUBMIT_IN_PROGRESS": return "本轮提交还在处理中，请不要重复操作。";
    case "SUBMIT_STATUS_UNKNOWN": return "提交结果尚未确认，点击核验提交状态；不会再次发送提交。";
    case "ROUND_ALREADY_SUBMITTED": return "本轮已提交或状态未确认，不能再保存答案，请先核对结果。";
    case "MASTERY_AUTO_RUNNING": return "当前课程正在自动完成掌握度，请先暂停或结束自动任务后再手动操作。";
    case "MASTERY_AUTO_NOT_RUNNING": return "当前没有正在运行的掌握度自动任务，请刷新状态。";
    case "AI_KEY_REQUIRED": return "选择 AI 答题策略时必须提供本次使用的 DeepSeek API Key。";
    case "ZHS_MASTERY_UNAVAILABLE": return "掌握度服务读取失败，稍后再试。";
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
    case "COOKIE_IMPORT_FAILED": return "Cookie 登录组件异常或无法完成服务器核验，请运行连接诊断。";
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
export type ZhidaoQrState = {stage:ZhidaoQrStage;image_png_base64?:string|null;reason?:string};
export function zhidaoQrCommand(action:"start"|"status"|"cancel"):Promise<ZhidaoQrState>{
  const operation = ({start:"zhidao.qr.start",status:"zhidao.qr.status",
    cancel:"zhidao.qr.cancel"} as const)[action];
  return request<ZhidaoQrState>({operation});
}

// ---------------------------------------------------------------------------
// 掌握度（AI 课程作业）
//
// 一条练习的生命周期由后端持有：start -> answer x N -> submit。
// 掌握度本身走只读接口，不会因为"看一眼"就多建一张卷。
// ---------------------------------------------------------------------------

export type MasteryBand = "low" | "mid" | "high";

export type MasteryKnowledge = {
  knowledge_id: string;
  name: string;
  theme: string;
  chapter_index?: number;
  study_progress: number;
  free_exam: boolean;
  mastery: number | null;
  band: MasteryBand | null;
  mastery_error?: string;
};

export type MasteryCatalog = {
  course_key: string;
  course_id: string;
  class_id: string;
  course_name: string;
  threshold: number;
  knowledge: MasteryKnowledge[];
  count: number;
  pending_count: number;
  average_mastery: number | null;
  unreadable_count?: number;
  verified_at: string;
};

export type MasteryQuestion = {
  question_id: number;
  content: string;
  question_type: number;
  type_name: string;
  options: Array<{id: number; content: string; sort?: number}>;
};

export type MasteryRound = {
  course_key: string;
  knowledge_id: string;
  exam_test_id: number;
  exam_paper_id: number;
  question_num: number;
  questions: MasteryQuestion[];
  high_mastery: number | null;
  mastery: number | null;
  mastery_change: number | null;
  threshold: number;
  opened_at: string;
};

export type MasteryActiveRound = {
  knowledge_id: string;
  exam_test_id: number;
  exam_paper_id: number;
  questions: MasteryQuestion[];
  answers: Record<string, string>;
  draft: Record<string, string | number | Array<string | number>>;
  answered: number;
  total: number;
  high_mastery: number | null;
  opened_at: string;
  submission_state?: "draft" | "sending" | "submitted" | "unknown";
};

export type MasteryAnswerResult = {
  knowledge_id: string;
  question_id: string;
  saved: boolean;
  answered: number;
  total: number;
  complete: boolean;
};

export type MasteryGraded = {
  questionId: number;
  questionType: number;
  graded: boolean;
  isCorrect: boolean;
  answers: Array<{answer: string; isCorrect: boolean}>;
  correctOptionIds: number[];
  correctTexts: string[];
  analysis: string;
};

export type MasterySubmitResult = {
  knowledge_id: string;
  exam_test_id: number;
  exam_paper_id: number;
  submitted: boolean;
  grading_pending?: boolean;
  verification_pending?: boolean;
  round_score: {correct: number | null; total: number; percent: number | null};
  graded: MasteryGraded[];
  mastery_before: {high: number | null; this_round_start: number | null};
  mastery_after: {mastery: number; band: MasteryBand; reached_threshold: boolean} | null;
  mastery_error: string | null;
  high_mastery_now: number | null;
  threshold: number;
  reached_threshold: boolean;
  next_round_hint: "reached" | "study_first" | "practice_more";
  verified_at: string;
};

export function masteryCatalog(courseKey: string, withMastery = true, forceRefresh = false): Promise<MasteryCatalog> {
  return request<MasteryCatalog>({operation: "zhidao.mastery.catalog", course_key: courseKey, with_mastery: withMastery, force_refresh: forceRefresh});
}

export function masteryStartRound(courseKey: string, knowledgeId: string): Promise<MasteryRound> {
  return request<MasteryRound>({operation: "zhidao.mastery.round.start", course_key: courseKey, knowledge_id: knowledgeId});
}

export function masteryActiveRound(courseKey: string, knowledgeId: string): Promise<MasteryActiveRound | null> {
  return request<MasteryActiveRound | null>({operation: "zhidao.mastery.round.active", course_key: courseKey, knowledge_id: knowledgeId});
}

export function masterySaveAnswer(
  courseKey: string, knowledgeId: string, questionId: string | number,
  answer: string | number | Array<string | number>,
): Promise<MasteryAnswerResult> {
  return request<MasteryAnswerResult>({
    operation: "zhidao.mastery.round.answer",
    course_key: courseKey, knowledge_id: knowledgeId,
    question_id: String(questionId), answer,
  });
}

export function masterySubmitRound(courseKey: string, knowledgeId: string): Promise<MasterySubmitResult> {
  return request<MasterySubmitResult>({operation: "zhidao.mastery.round.submit", course_key: courseKey, knowledge_id: knowledgeId});
}

export function masteryDiscardRound(courseKey: string, knowledgeId: string): Promise<{knowledge_id: string; discarded: boolean}> {
  return request<{knowledge_id: string; discarded: boolean}>({operation: "zhidao.mastery.round.discard", course_key: courseKey, knowledge_id: knowledgeId});
}

export function masteryWrongQuestions(
  courseKey: string, knowledgeId: string, examTestId?: string,
): Promise<{knowledge_id: string; mastery: number | null; questions: unknown[]; count: number}> {
  return request({operation: "zhidao.mastery.wrong", course_key: courseKey, knowledge_id: knowledgeId, exam_test_id: examTestId});
}


export type MasteryAutoSettings = {
  target: number; max_rounds: number; stagnation_rounds: number; max_minutes: number;
  first_round_mode: "bank_only" | "bank_ai" | "ai_first" | "arbitrary_first";
  max_ai_calls: number; api_key?: string;
  use_external_bank?: boolean; external_provider_id?: string;
  external_token_id?: string; max_external_calls?: number;
  scope_mode?: "all" | "first_n" | "single" | "selected";
  chapter_count?: number; chapter_indices?: number[];
};
export type MasteryAutoTask = {
  knowledge_id: string; name: string; theme: string;
  mastery: number | null; state: "pending"|"working"|"done"|"skipped";
  rounds: number; reason: string; chapter_index?: number;
};
export type MasteryAutoStatus = {
  run_id?: string; course_key?: string; course_name?: string;
  state: "idle"|"starting"|"running"|"pausing"|"paused"|"stopping"|"stopped"|"completed"|"error"|"interrupted"|"needs_attention";
  message?: string; total: number; processed: number; done: number; skipped: number;
  current?: {knowledge_id:string;name:string;theme:string}|null;
  submitting?: {knowledge_id:string;exam_test_id:number}|null;
  blocked?: string[]; tasks: MasteryAutoTask[]; updated_at?: string;
  chapter_total?: number; selected_chapters?: Array<{index:number;name:string;knowledge_count:number}>;
  ai_calls?: number; ai_used?: number; ai_errors?: number;
  bank_hits?: number; trials?: number;
  external_calls?: number; external_hits?: number; external_misses?: number; external_errors?: number;
};
export function masteryAutoStart(courseKey: string, settings: MasteryAutoSettings): Promise<MasteryAutoStatus> {
  return request<MasteryAutoStatus>({operation:"zhidao.mastery.auto.start",course_key:courseKey,settings});
}
export function masteryAutoStatus(courseKey: string): Promise<MasteryAutoStatus> {
  return request<MasteryAutoStatus>({operation:"zhidao.mastery.auto.status",course_key:courseKey});
}
export function masteryAutoControl(courseKey: string, action: "pause"|"resume"|"stop"): Promise<MasteryAutoStatus> {
  return request<MasteryAutoStatus>({operation:"zhidao.mastery.auto.control",course_key:courseKey,action});
}

/** Shared question-bank contracts: usable from any learning/assignment component. */
export type QuestionBankProvider={id:string;name:string;description:string;homepage?:string|null;quota_unit?:string;supports_check?:boolean};
export type QuestionBankToken={id:string;provider_id:string;label:string;active:boolean;
  validity?:"unchecked"|"valid"|"invalid"|"unknown";checked_at?:string|null;
  remaining?:number|null;balance_at?:string|null;check_reason?:string|null;};
export type QuestionBankState={providers:QuestionBankProvider[];tokens:QuestionBankToken[];
  rotation_modes?:Record<string,"fixed"|"round_robin">;added?:number;skipped?:number;};
export type QuestionBankQuestion={
  title:string;question_type?:string;
  options?:string|Array<{key?:string;text:string}>;
};
export type QuestionBankAnswer={
  found:boolean;answer:string;remaining:number|null;
  status:"matched"|"not_found";source?:string;
  provider_id:string;provider_name:string;
  token_id:string;token_label:string;verified:false;
};
export function questionBankList():Promise<QuestionBankState>{
  return request<QuestionBankState>({operation:"questionbank.tokens.list"});
}
export function questionBankImportTokens(provider_id:string,lines:string):Promise<QuestionBankState>{
  return request<QuestionBankState>({operation:"questionbank.tokens.import",provider_id,lines});
}
export function questionBankSetRotation(provider_id:string,mode:"fixed"|"round_robin"):Promise<QuestionBankState>{
  return request<QuestionBankState>({operation:"questionbank.tokens.rotation",provider_id,mode});
}
export function questionBankSelectToken(token_id:string):Promise<QuestionBankState>{
  return request<QuestionBankState>({operation:"questionbank.tokens.select",token_id});
}
export function questionBankCheckToken(token_id:string,include_quota=false):Promise<QuestionBankState>{
  return request<QuestionBankState>({operation:"questionbank.tokens.check",token_id,include_quota});
}
export function questionBankRemoveToken(token_id:string):Promise<QuestionBankState>{
  return request<QuestionBankState>({operation:"questionbank.tokens.remove",token_id});
}
export function questionBankQuery(
  provider_id:string,question:QuestionBankQuestion,token_id?:string
):Promise<QuestionBankAnswer>{
  return request<QuestionBankAnswer>({operation:"questionbank.query",provider_id,question,
    ...(token_id?{token_id}:{})});
}
