import {invoke} from "@tauri-apps/api/core";
import type {Platform} from "./types";
import {isDesktop, request} from "./bridge";

export type LegacyTaskState = "idle" | "running" | "exited" | "stopped";
export type ZhsLocalProgress = {
  video_segment_percent: number | null;
  resource_index: number | null;
  resource_total: number | null;
};

export type LegacyTaskStatus = {
  platform: Platform;
  state: LegacyTaskState;
  exit_code: number | null;
  run_id?: string | null;
  course_id: string | null;
  zhs_progress: ZhsLocalProgress | null;
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
  rich_total: number | null;
  rich_current: number | null;
  rich_processed: number;
  rich_success: number;
  rich_failed: number;
};

/** Reads only the current executor run\u2019s original logged progress. */
export async function getYuketangLiveProgress(runId: string): Promise<YuketangLiveProgress> {
  ensureDesktop();
  if (!/^[0-9]{1,15}-[0-9]{1,20}$/.test(runId)) throw new Error("INVALID_REQUEST");
  return request<YuketangLiveProgress>({operation:"yuketang.progress", run_id:runId});
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
  auto_richtext: false
});

export function validateOriginalOptions(input: OriginalYktOptions): boolean {
  return Number.isFinite(input.video_speed) && input.video_speed >= 0.1 && input.video_speed <= 4 &&
    Number.isInteger(input.heartbeat_interval) && input.heartbeat_interval >= 1 && input.heartbeat_interval <= 120 &&
    Number.isInteger(input.max_concurrent_videos) && input.max_concurrent_videos >= 1 && input.max_concurrent_videos <= 32 &&
    Number.isInteger(input.completion_threshold) && input.completion_threshold >= 0 && input.completion_threshold <= 100 &&
    Number.isInteger(input.test_video_count) && input.test_video_count >= 1 && input.test_video_count <= 10000 &&
    typeof input.skip_completed === "boolean" && typeof input.use_concurrent === "boolean" &&
    typeof input.test_mode === "boolean" && typeof input.auto_richtext === "boolean";
}

function ensureDesktop() {
  if (!isDesktop()) throw new Error("RUN_NOT_AVAILABLE");
}

export async function getLegacyStatus(platform: Platform): Promise<LegacyTaskStatus> {
  ensureDesktop();
  return invoke<LegacyTaskStatus>("legacy_status", {platform});
}

export async function startLegacy(
  platform: Platform, courseId?: string, options?: OriginalYktOptions
): Promise<LegacyTaskStatus> {
  ensureDesktop();
  if (platform === "zhidao" && (!courseId || !/^[a-f0-9]{64}$/.test(courseId))) {
    throw new Error("INVALID_COURSE");
  }
  if (platform === "yuketang" && options && !validateOriginalOptions(options)) {
    throw new Error("INVALID_SETTINGS");
  }
  return invoke<LegacyTaskStatus>("legacy_start", {
    platform,
    courseId: platform === "zhidao" ? courseId : null,
    options: platform === "yuketang" ? options ?? null : null,
  });
}

export async function stopLegacy(platform: Platform): Promise<LegacyTaskStatus> {
  ensureDesktop();
  return invoke<LegacyTaskStatus>("legacy_stop", {platform});
}

export function legacyError(err: unknown): string {
  const code = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  switch (code) {
    case "INVALID_COURSE": return "请先同步课程并选择有效的知到智慧课程。";
    case "INVALID_SETTINGS": return "雨课堂原版参数超出支持范围。";
    case "TASK_ALREADY_RUNNING": return "该平台原版任务已在运行，请先停止后再启动。";
    case "LEGACY_NOT_INSTALLED": return "缺少学序本机执行器或原版知到运行环境。";
    case "LEGACY_LAUNCH_FAILED": return "原版任务启动失败，请检查 Windows 运行环境。";
    case "TASK_STATE_UNAVAILABLE": return "无法获取本地任务状态。";
    case "RUN_NOT_AVAILABLE": return "网页版无法运行原版任务，请启动 Windows 桌面版。";
    default: return "原版任务操作失败，请检查安装与登录状态。";
  }
}
