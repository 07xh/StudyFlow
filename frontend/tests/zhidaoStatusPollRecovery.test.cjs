const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Zhidao and Yuketang task polling cannot freeze after a hung desktop IPC read',()=>{
  const panel=fs.readFileSync(path.join(__dirname,'../src/components/LegacyPlaybackPanel.tsx'),'utf8');
  assert.match(panel,/statusPollInFlight\.current === platform/);
  assert.match(panel,/Promise\.race<LegacyTaskStatus>/);
  assert.match(panel,/getLegacyStatus\(platform\)/);
  assert.match(panel,/window\.setTimeout\(\(\)=>reject\(new Error\("TASK_STATUS_TIMEOUT"\)\),15000\)/);
  assert.match(panel,/window\.clearTimeout\(timeoutId\)/);
  assert.match(panel,/setStatusReadFailed\(true\)/);
});
