export type Platform = "zhidao" | "yuketang";
export type ConnectionStatus = "not_connected" | "connecting" | "connected" | "error";

/** Explicitly sourced evidence; never infer completion from a local playback counter. */
export type ProgressEvidence = "server_verified" | null;

export interface Course {
  platform: Platform;
  course_id: string;
  title: string;
  progress_percent: number | null;
  course_type?: "ai" | "shared" | null;
  stale?: boolean;
  progress_evidence?: ProgressEvidence;
  verified_at?: string | null;
}
export interface PlatformState {
  platform: Platform;
  status: ConnectionStatus;
  message: string;
  courses: Course[];
}
