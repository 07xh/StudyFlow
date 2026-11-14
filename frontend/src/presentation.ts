import type {Course, Platform, PlatformState} from "./types";

export const platformNames: Record<Platform, string> = {zhidao: "知到", yuketang: "雨课堂"};

export type CoursePresentation = {
  status: "cached" | "verified" | "unverified";
  label: string;
  detail: string;
  percent: number | null;
};

export function presentCourse(course: Course): CoursePresentation {
  if (course.stale) {
    return {status: "cached", label: "历史缓存待核验", detail: "历史记录仅供参考，请重新同步核验", percent: null};
  }
  const value = course.progress_percent;
  // A numeric progress value alone is not evidence of platform verification.
  if (course.progress_evidence === "server_verified" && typeof value === "number" &&
      Number.isFinite(value) && value >= 0 && value <= 100 && Boolean(course.verified_at)) {
    return {status: "verified", label: "服务器已核验", detail: "平台返回的上次核验记录", percent: value};
  }
  return {status: "unverified", label: "未核验", detail: "暂无可确认的服务器学习进度", percent: null};
}

export function courseKey(course: Course): string {
  return course.platform + ":" + course.course_id;
}

export function describeConnection(state: PlatformState): string {
  switch (state.status) {
    case "connected": return "服务端会话已核验";
    case "connecting": return "正在检测";
    case "error": return "检测异常";
    default: return "尚未确认连接";
  }
}
