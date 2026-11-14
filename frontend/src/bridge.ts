import type {Platform, PlatformState, Course} from "./types";

/** The host must inject this capability only into a trusted desktop window. */
export type BridgeRequest =
  | {id: string; version: 1; operation: "ping"}
  | {id: string; version: 1; operation: "platform.status"}
  | {id: string; version: 1; operation: "courses.list"; platform: Platform};

export type BridgeResponse<T> =
  | {id: string | null; ok: true; data: T}
  | {id: string | null; ok: false; error: string};

export interface StudyFlowTransport {
  request<T>(message: BridgeRequest): Promise<BridgeResponse<T>>;
}

declare global {
  interface Window {
    studyflowTransport?: StudyFlowTransport;
  }
}

/** Browser preview has no data transport. Do not use a fake HTTP API or sample courses. */
export function getStudyFlowTransport(): StudyFlowTransport | null {
  if (typeof window === "undefined") return null;
  const candidate = window.studyflowTransport;
  return candidate && typeof candidate.request === "function" ? candidate : null;
}

let requestSerial = 0;
function nextId(): string {
  requestSerial += 1;
  return "ui-" + Date.now().toString(36) + "-" + requestSerial;
}

async function checkedRequest<T>(
  transport: StudyFlowTransport,
  message: BridgeRequest,
): Promise<T> {
  const response = await transport.request<T>(message);
  if (!response || response.id !== message.id || typeof response.ok !== "boolean") {
    throw new Error("INVALID_IPC_RESPONSE");
  }
  if (!response.ok) {
    // Never forward arbitrary exception text or sensitive upstream data to the UI.
    const allowed = new Set(["INVALID_REQUEST", "UNSUPPORTED_VERSION", "UNKNOWN_PLATFORM", "PLATFORM_NOT_READY", "UNKNOWN_OPERATION"]);
    throw new Error(allowed.has(response.error) ? response.error : "PLATFORM_NOT_READY");
  }
  return response.data;
}

function isPlatform(value: unknown): value is Platform {
  return value === "zhidao" || value === "yuketang";
}

export async function fetchPlatformStatuses(transport: StudyFlowTransport): Promise<PlatformState[]> {
  const data = await checkedRequest<unknown>(transport, {id: nextId(), version: 1, operation: "platform.status"});
  if (!Array.isArray(data)) throw new Error("INVALID_IPC_RESPONSE");
  const result = new Map<Platform, PlatformState>();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (!isPlatform(item.platform) || typeof item.connected !== "boolean") continue;
    result.set(item.platform, {
      platform: item.platform,
      status: item.connected ? "connected" : "not_connected",
      message: typeof item.message === "string" ? item.message.slice(0, 180) : "连接状态未确认",
      courses: [],
    });
  }
  if (result.size !== 2) throw new Error("INVALID_IPC_RESPONSE");
  return ["zhidao", "yuketang"].map(p => result.get(p as Platform)!);
}

export async function fetchCourses(transport: StudyFlowTransport, platform: Platform): Promise<Course[]> {
  const data = await checkedRequest<unknown>(transport, {id: nextId(), version: 1, operation: "courses.list", platform});
  if (!Array.isArray(data)) throw new Error("INVALID_IPC_RESPONSE");
  const courses: Course[] = [];
  const identities = new Set<string>();
  for (const entry of data) {
    if (!entry || typeof entry !== "object") throw new Error("INVALID_IPC_RESPONSE");
    const row = entry as Record<string, unknown>;
    if (row.platform !== platform || typeof row.course_id !== "string" ||
        !row.course_id.trim() || typeof row.title !== "string" || !row.title.trim()) {
      throw new Error("INVALID_IPC_RESPONSE");
    }
    const id = row.course_id.slice(0, 128);
    if (identities.has(id)) continue;
    identities.add(id);
    const percent = row.progress_percent;
    const validPercent = typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100;
    courses.push({
      platform,
      course_id: id,
      title: row.title.slice(0, 250),
      progress_percent: validPercent ? percent : null,
      course_type: row.course_type === "ai" || row.course_type === "shared" ? row.course_type : null,
      stale: row.stale === true,
      progress_evidence: row.progress_evidence === "server_verified" ? "server_verified" : null,
      verified_at: typeof row.verified_at === "string" && row.verified_at.length <= 64 ? row.verified_at : null,
    });
  }
  return courses;
}

export function friendlyBridgeError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "PLATFORM_NOT_READY") return "平台运行时尚未准备完成，课程未读取。";
  if (code === "INVALID_IPC_RESPONSE") return "本机数据通信格式异常，未加载课程。";
  if (code === "UNSUPPORTED_VERSION") return "前后端协议版本不匹配。";
  return "无法完成本机数据读取，请检查桌面运行时。";
}
