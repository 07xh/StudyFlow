import {invoke} from "@tauri-apps/api/core";
import type {Platform, PlatformState, Course} from "./types";

export type Video = {id: string; name: string; chapter: string};
export type Config = {session_id: string; csrf_token: string; classroom_id: string; university_id: string; sign: string};
export type BridgeRequest =
  | {id: string; version: 1; operation: "ping"}
  | {id: string; version: 1; operation: "platform.status"}
  | {id: string; version: 1; operation: "courses.list"; platform: Platform}
  | {id: string; version: 1; operation: "videos.list"; platform: "yuketang"}
  | {id: string; version: 1; operation: "yuketang.configure"; configuration: Config}
  | {id: string; version: 1; operation: "yuketang.clear"}
  | {id: string; version: 1; operation: "zhidao.cookie.import"; content: string; mode: "file" | "text"}
  | {id: string; version: 1; operation: "zhidao.qr.start" | "zhidao.qr.status" | "zhidao.qr.cancel"};

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

/** Real Tauri/sidecar interface only. A browser preview never simulates a local service. */
export function getStudyFlowTransport(): StudyFlowTransport | null {
  if (!isDesktop()) return null;
  return {
    async request<T>(message: BridgeRequest): Promise<BridgeResponse<T>> {
      try {
        return await invoke<BridgeResponse<T>>("bridge_request", {request: message});
      } catch {
        throw new Error("BRIDGE_NOT_READY");
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
    const allowed = new Set(["INVALID_REQUEST", "UNSUPPORTED_VERSION", "UNKNOWN_PLATFORM",
                             "PLATFORM_NOT_READY", "UNKNOWN_OPERATION", "CREDENTIAL_STORAGE_FAILED",
                             "ZHIDAO_QR_UNAVAILABLE", "INVALID_COOKIE_IMPORT", "COOKIE_IMPORT_FAILED"]);
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
  return value === "zhidao" || value === "yuketang";
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
  if (result.size !== 2) throw new Error("INVALID_IPC_RESPONSE");
  return ["zhidao", "yuketang"].map(p => result.get(p as Platform)!);
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
    });
  }
  return result;
}

export async function fetchCoursesFromDesktop(platform: Platform): Promise<Course[]> {
  const transport = getStudyFlowTransport();
  if (!transport) throw new Error("BRIDGE_NOT_READY");
  return fetchCourses(transport, platform);
}

export function friendlyBridgeError(value: unknown): string {
  const code = value instanceof Error ? value.message : "";
  switch (code) {
    case "BRIDGE_NOT_READY": return "学序 Windows IPC 服务不可用；请检查桌面版和 Python sidecar。";
    case "INVALID_IPC_RESPONSE": return "本机数据响应不符合协议，课程未加载。";
    case "PLATFORM_NOT_READY": return "真实平台课程读取失败；请检查账号、网络和原版运行时。";
    case "CREDENTIAL_STORAGE_FAILED": return "Windows 凭据管理器保存失败。";
    case "UNSUPPORTED_VERSION": return "桌面端与数据服务协议版本不一致。";
    case "UNKNOWN_PLATFORM": return "不支持该学习平台。";
    case "INVALID_REQUEST": return "本机请求格式有误。";
    case "ZHIDAO_QR_UNAVAILABLE": return "知到扫码服务尚不可用，检查原版安装与网络。";
    case "INVALID_COOKIE_IMPORT": return "Cookie 内容为空、格式不正确或超过原版支持的大小。";
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
