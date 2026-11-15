const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','src');
const recovery=fs.readFileSync(path.join(root,'taskRecovery.tsx'),'utf8');
const panel=fs.readFileSync(path.join(root,'components','LegacyPlaybackPanel.tsx'),'utf8');
const app=fs.readFileSync(path.join(root,'App.tsx'),'utf8');
const tasks=fs.readFileSync(path.join(root,'runtimeTasks.ts'),'utf8');
test('restart intent excludes cookies, heartbeat data, credentials and completion claims',()=>{
  const schema=recovery.slice(recovery.indexOf('export type TaskRecoveryRecord='),recovery.indexOf('};',recovery.indexOf('export type TaskRecoveryRecord=')));
  for(const forbidden of ['cookie','csrf','session_id','sign','heartbeat','progressPercent','serverCompleted'])
    assert.equal(schema.includes(forbidden),false,forbidden);
  assert.match(recovery,/MAX_AGE=30\*24\*60\*60\*1000/);
  assert.match(recovery,/validateZhsOptions\(v\.zhsOptions\)/);
  assert.match(recovery,/validateOriginalOptions\(v\.yuketangOptions\)/);
});
test('recovery refuses current running jobs and verifies platform state',()=>{
  assert.match(recovery,/if\(latest\.state==="running"\)throw/);
  assert.match(recovery,/operation:"zhidao\.progress\.verify"/);
  assert.match(recovery,/progress_evidence!=="server_verified"/);
  assert.match(recovery,/scope\.classroom_id!==record\.classroomId/);
  assert.match(recovery,/identity.marker!==record.sessionMarker/);
  assert.match(recovery,/operation:"yuketang\.course\.detail"/);
  assert.match(recovery,/operation:"courses\.list",platform:"yuketang"/);
  assert.match(recovery,/!scope\.has_session/);
  assert.doesNotMatch(recovery,/!scope\.has_session\|\|!scope\.has_sign/);
});
test('both executors persist after launch and explicit stops discard correct run ID',()=>{
  assert.match(panel,/rememberTaskRecovery\(\{version:1,platform:"zhidao"/);
  assert.match(panel,/rememberTaskRecovery\(\{version:1,platform:"yuketang"/);
  assert.match(panel,/sessionMarker,yuketangOptions:options/);
  assert.match(panel,/discardTaskRecovery\(platform,status\.run_id\)/);
  assert.match(tasks,/discardTaskRecovery\(task\.platform,task\.runId\)/);
  assert.match(app,/<TaskRecoveryPanel/);
});
