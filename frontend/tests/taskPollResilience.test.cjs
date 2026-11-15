const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panel = fs.readFileSync(path.join(__dirname,'../src/components/LegacyPlaybackPanel.tsx'),'utf8');
const rust = fs.readFileSync(path.join(__dirname,'../../src-tauri/src/legacy_tasks.rs'),'utf8');

test('IPC status failure retains run ID but hides cached progress',()=>{
  assert.match(panel,/setStatusReadFailed\(true\);setYktProgress\(null\)/);
  assert.match(panel,/const liveZhs = !statusReadFailed && platform/);
  assert.match(panel,/当前无法确认任务状态；请先查询运行状态/);
  assert.match(panel,/setStatusReadFailed\(false\)/);
  assert.match(panel,/statusReadFailed \? "状态待核实"/);
  assert.doesNotMatch(panel,/setStatus\(null\);setYktProgress\(null\);\s*setMessage\("无法读取本地任务状态/);
});

test('rc.6 ZHS exit diagnostics do not appear as live after an IPC failure',()=>{
  assert.match(panel,/status\?\.state==="exited"&&ownsStatus&&!statusReadFailed&&<div className="sf-task-context sf-zhs-exit-diagnostic"/);
  assert.match(panel,/zhsDiagnosticMessage\(status\)/);
});

test('Windows legacy task operations run in Tauri blocking pool',()=>{
  for(const operation of ['legacy_start','legacy_status','legacy_stop']){
    assert.match(rust,new RegExp('pub async fn '+operation+'\\('));
  }
  assert.equal((rust.match(/tauri::async_runtime::spawn_blocking/g)||[]).length,3);
  assert.match(rust,/verify_expected_run\(expected_run_id\.as_deref\(\), job\.run_id\.as_deref\(\)\)/);
  assert.match(rust,/diagnostic_code:/);
});
