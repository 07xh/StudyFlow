const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root=path.resolve(__dirname,"../..");
const controller=fs.readFileSync(path.join(root,"legacy/zhidao/Official-MediaController.js"),"utf8");
const rust=fs.readFileSync(path.join(root,"src-tauri/src/zhidao_player.rs"),"utf8");
const powershell=fs.readFileSync(path.join(root,"legacy/zhidao/Official-Player.ps1"),"utf8");

test("official WebView2 monitor refreshes read-only progress before the Rust freshness deadline",()=>{
  const interval=Number(controller.match(/const MONITOR_INTERVAL_MS = (\d+);/)?.[1]);
  const staleSec=Number(rust.match(/if age > Duration::from_secs\((\d+)\)/)?.[1]);
  assert.ok(interval>0 && interval<=staleSec*500,
    "local observation interval must leave a margin under the stale deadline");
  assert.match(controller,/time - monitor\.lastReport >= MONITOR_INTERVAL_MS/,
    "running video must not wait 60 seconds between local observations");
  assert.doesNotMatch(controller,/time - monitor\.lastReport >= 60000/);
});

test("unchanged paused and stalled media also refresh their true local state",()=>{
  assert.match(controller,/force \|\| state !== monitor\.lastState \|\|\s*time - monitor\.lastReport >= MONITOR_INTERVAL_MS/);
  assert.match(controller,/kind: 'playback-health'/);
  assert.match(powershell,/Write-OfficialPlaybackObservation \$event \$position \$duration/);
  assert.match(controller,/if \(!onCoursePlayerPage\(\)\)/);
  assert.match(controller,/if \(!primaryVideo \|\| !visible\(primaryVideo\)\)/);
});
