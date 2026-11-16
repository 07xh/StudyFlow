const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const official=path.join(root,"frontend/src/components/XuexitongHeartbeatPanel.tsx");
const copy=path.join(root,"integration/frontend/XuexitongHeartbeatPanel.tsx");

test("integration heartbeat panel copy is byte-identical to the shipped component",()=>{
  assert.ok(fs.existsSync(official),"shipped component must exist");
  assert.ok(fs.existsSync(copy),"integration copy must exist");
  assert.deepEqual(fs.readFileSync(copy),fs.readFileSync(official));
});

test("Xuexitong task controls keep run identity and shared parameter defaults",()=>{
  const source=fs.readFileSync(official,"utf8");
  const bridge=fs.readFileSync(path.join(root,"frontend/src/bridge.ts"),"utf8");
  const rust=fs.readFileSync(path.join(root,"src-tauri/src/lib.rs"),"utf8");
  assert.match(source,/if\(!runId\)throw new Error\("XUEXITONG_RUN_ID_REQUIRED"\)/);
  for(const operation of ["pause","resume","stop"]){
    assert.ok(source.includes('operation:"xuexitong.heartbeat.'+operation+'",run_id:runId'));
    assert.ok(bridge.includes('operation:"xuexitong.heartbeat.'+operation+'";run_id:string'));
  }
  assert.ok(source.includes('operation:"xuexitong.settings.save"'));
  assert.ok(source.includes('settings:{...defaults,playback_speed:speed,concurrency:jobs}'));
  assert.ok(rust.includes('request.get("graceful").is_none()'));
  assert.ok(bridge.includes('case "XUEXITONG_RUN_ID_REQUIRED":'),
    "Missing run identity must have an actionable UI explanation");
});

test("Xuexitong panel does not control a different course",()=>{
  const source=fs.readFileSync(official,"utf8");
  assert.ok(source.includes("const currentStatus=status?.course_key===course.course_id?status:null;"),
    "The panel must discard previous-course status immediately");
  assert.ok(source.includes("const runId=currentStatus?.run_id;"),
    "Run controls must use the selected course, never stale status");
  assert.ok(source.includes("if(selectedCourse.current===actionCourse)setMessage("),
    "Responses from a previous course must not update the current course");
  assert.ok(source.includes('setStatus(null);setLogs([]);setMessage("");'),
    "Navigation must clear stale messages and logs");
  assert.ok(source.includes("Number.isFinite(speed)")&&source.includes("Number.isInteger(jobs)"),
    "Speed and chapter counts require validation before starting");
  assert.ok(source.includes("disabled={busy||!desktop||running||!validConfig}"),
    "Invalid settings must not enable start");
  assert.ok(source.includes("本地记录（非播放证明）"),
    "Local scheduling estimates must be distinct from verified playback");
});
