const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const load=require("./helpers/load.cjs");
const {
  COURSE_SYNC_FRESH_MS,COURSE_SYNC_RETRY_MS,newCourseSyncCheckpoint,
  shouldStartCourseSync,invalidateCourseSync
}=load("courseAutoSync.ts");

test("connected platform course synchronization is fresh for five minutes",()=>{
  const checkpoint=newCourseSyncCheckpoint();
  const now=1_800_000_000_000;
  assert.equal(shouldStartCourseSync(checkpoint,now),true);
  checkpoint.inFlight=true;
  assert.equal(shouldStartCourseSync(checkpoint,now),false);
  assert.equal(shouldStartCourseSync(checkpoint,now,true),false);
  checkpoint.inFlight=false;
  checkpoint.lastAttempt=now;
  checkpoint.lastSuccess=now;
  assert.equal(shouldStartCourseSync(checkpoint,now+COURSE_SYNC_FRESH_MS-1),false);
  assert.equal(shouldStartCourseSync(checkpoint,now+COURSE_SYNC_FRESH_MS),true);
  assert.equal(shouldStartCourseSync(checkpoint,now+1,true),true);
});

test("failed automatic read backs off instead of repeatedly hammering the platform",()=>{
  const checkpoint=newCourseSyncCheckpoint();
  const now=1_800_000_000_000;
  checkpoint.lastAttempt=now;
  assert.equal(shouldStartCourseSync(checkpoint,now+1),false);
  assert.equal(shouldStartCourseSync(checkpoint,now+COURSE_SYNC_RETRY_MS),true);
});

test("session invalidation drops stale results and permits fresh automatic reads",()=>{
  const checkpoint=newCourseSyncCheckpoint();
  checkpoint.inFlight=true;
  checkpoint.lastAttempt=1_800_000_000_000;
  checkpoint.lastSuccess=1_800_000_000_000;
  const oldEpoch=checkpoint.epoch;
  invalidateCourseSync(checkpoint);
  assert.ok(checkpoint.epoch>oldEpoch);
  assert.equal(checkpoint.inFlight,false);
  assert.equal(shouldStartCourseSync(checkpoint,1_800_000_000_100),true);
});

test("desktop app wires course loading to startup, login refresh, entry and focus without auto-starting playback",()=>{
  const app=fs.readFileSync(path.join(__dirname,"../src/App.tsx"),"utf8");
  assert.match(app,/setStatusCheckRevision\(previous=>previous\+1\)/);
  assert.match(app,/const newStatusCheck=statusCheckRevision!==lastObservedStatusCheck\.current/);
  assert.match(app,/page==="platform-"\+platform/);
  assert.match(app,/window\.addEventListener\("focus",onFocus\)/);
  assert.match(app,/shouldStartCourseSync\(checkpoint,Date\.now\(\),manual\)/);
  assert.match(app,/invalidateCourseSync\(syncCheckpoints\.current\[platform\]\)/);
  assert.match(app,/fetchCoursesFromDesktop\(platform\)/);
  assert.match(app,/onClick=\{\(\)=>void sync\(platform,true\)\}/);
  assert.doesNotMatch(app,/auto.*(start.*playback|视频播放)/i);
});
