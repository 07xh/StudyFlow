/** Platform IDs are extensible; the backend still validates supported adapters. */
export type Platform = string;
export type ConnectionStatus = "not_connected" | "connecting" | "connected" | "error";
export interface Course { platform: Platform; course_id: string; title: string; progress_percent: number | null; }
export interface PlatformState { platform: Platform; status: ConnectionStatus; message: string; courses: Course[]; }
