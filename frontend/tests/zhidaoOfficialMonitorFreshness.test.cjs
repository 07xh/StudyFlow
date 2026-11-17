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
  // The patch guard is shared by both pinned runtime copies.
  assert.match(rust,/output\.matches\(\*old\)\.count\(\) != 1/);
  assert.match(rust,/\(OFFICIAL_MONITOR_INTERVAL_OLD, &interval\)/);
  assert.match(rust,/\(OFFICIAL_MONITOR_REPORT_OLD, OFFICIAL_MONITOR_REPORT_NEW\)/);
  assert.match(rust,/time - monitor\.lastReport >= MONITOR_INTERVAL_MS/);
  assert.match(rust,/fs::write\(&controller, fresh\)/);
  assert.match(powershell,/Write-OfficialPlaybackObservation \$event \$position \$duration/);
});
