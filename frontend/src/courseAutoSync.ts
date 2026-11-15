/** Frontend-only scheduling gate for read-only course listing. No fabricated data or background player tasks. */
export const COURSE_SYNC_FRESH_MS = 5 * 60 * 1000;
export const COURSE_SYNC_RETRY_MS = 60 * 1000;

export type CourseSyncCheckpoint = {
  lastSuccess: number;
  lastAttempt: number;
  epoch: number;
  inFlight: boolean;
};

export function newCourseSyncCheckpoint(): CourseSyncCheckpoint {
  return {lastSuccess: 0, lastAttempt: 0, epoch: 0, inFlight: false};
}

/** Manual refresh bypasses freshness/retry cooldowns but never duplicates an in-flight request. */
export function shouldStartCourseSync(checkpoint: CourseSyncCheckpoint, now: number, manual = false): boolean {
  if (checkpoint.inFlight) return false;
  if (manual) return true;
  return (checkpoint.lastSuccess === 0 || now - checkpoint.lastSuccess >= COURSE_SYNC_FRESH_MS)
    && (checkpoint.lastAttempt === 0 || now - checkpoint.lastAttempt >= COURSE_SYNC_RETRY_MS);
}

/** A login/session change invalidates both freshness and any pending response from the old session. */
export function invalidateCourseSync(checkpoint: CourseSyncCheckpoint): void {
  checkpoint.epoch += 1;
  checkpoint.lastSuccess = 0;
  checkpoint.lastAttempt = 0;
  checkpoint.inFlight = false;
}
