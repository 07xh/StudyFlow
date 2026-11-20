const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const original=fs.readFileSync(path.join(root,"legacy/zhidao/Official-MediaController.js"),"utf8");
const rust=fs.readFileSync(path.join(root,"src-tauri/src/zhidao_player.rs"),"utf8");
const powershell=fs.readFileSync(path.join(root,"legacy/zhidao/Official-Player.ps1"),"utf8");

test("the pinned original official-controller source remains untouched",()=>{
  assert.match(original,/const MONITOR_INTERVAL_MS = 12000;/);
  assert.match(original,/time - monitor\.lastReport >= 60000/);
});

test("isolated official player observer cadence renews read-only progress before expiry",()=>{
  const interval=Number(rust.match(/const LOCAL_OBSERVER_INTERVAL_MS: u64 = (\d+);/)?.[1]);
  const staleSec=Number(rust.match(/if age > Duration::from_secs\((\d+)\)/)?.[1]);
  assert.ok(interval>0 && interval<=staleSec*500,
    "runtime observation interval must leave margin under stale deadline");
  assert.match(rust,/normalized\.matches\(OFFICIAL_MONITOR_INTERVAL_OLD\)/);
  assert.match(rust,/normalized\.matches\(OFFICIAL_MONITOR_REPORT_OLD\)/);
  assert.match(rust,/time - monitor\.lastReport >= MONITOR_INTERVAL_MS/);
  assert.match(rust,/fs::write\(&controller, fresh\)/);
  assert.match(powershell,/Write-OfficialPlaybackObservation \$event \$position \$duration/);
});

test("official player polling and close-time readback recover from hung or failed requests",()=>{
  const panel=fs.readFileSync(path.join(root,"frontend/src/components/ZhidaoOfficialPlayerPanel.tsx"),"utf8");
  const monitor=fs.readFileSync(path.join(root,"frontend/src/components/ZhidaoPlayerMonitor.tsx"),"utf8");
  assert.match(panel,/Promise\\.race<PlayerStatus>/);
  assert.match(panel,/PLAYER_STATUS_TIMEOUT/);
  assert.match(panel,/positionSeconds:null,durationSeconds:null,observedAt:null/);
  assert.match(monitor,/boundedRead\\(invoke<Status>\\("zhidao_player_status"\\),15000\\)/);
  assert.match(monitor,/lastAttempt\\.current\\.set\\(status\\.runId,now\\)/);
  assert.match(monitor,/if\\(now-last<60000\\)return/);
  assert.ok(monitor.indexOf('verifiedRuns.current.add(status.runId)')>
    monitor.indexOf('if(!target){'),
    "a failed readback must remain retryable");
});
