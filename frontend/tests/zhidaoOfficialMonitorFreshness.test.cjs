const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const original=fs.readFileSync(path.join(root,"legacy/zhidao/Official-MediaController.js"),"utf8");
const rust=fs.readFileSync(path.join(root,"src-tauri/src/zhidao_player.rs"),"utf8");
const native=fs.readFileSync(path.join(root,"src-tauri/src/lib.rs"),"utf8");
const config=JSON.parse(fs.readFileSync(path.join(root,"src-tauri/tauri.conf.json"),"utf8"));

test("the pinned original official-controller source remains untouched",()=>{
  assert.match(original,/const MONITOR_INTERVAL_MS = 12000;/);
  assert.match(original,/time - monitor\.lastReport >= 60000/);
});

test("retired player launch endpoints and bundled executable resources stay absent",()=>{
  assert.doesNotMatch(rust,/fn zhidao_player_(prepare|start)\b/);
  assert.doesNotMatch(native,/zhidao_player::zhidao_player_(prepare|start)\b/);
  for(const name of ["Official-Player.ps1","Official-MediaController.js","Install-WebView2.ps1"]){
    assert.ok(!Object.keys(config.bundle.resources).some(key=>key.endsWith("/"+name)));
  }
  assert.match(native,/zhidao_player::zhidao_player_stop/);
  assert.match(native,/zhidao_player::zhidao_player_clear_web_profile/);
});

test("retired official player UI is absent",()=>{
  const app=fs.readFileSync(path.join(root,"frontend/src/App.tsx"),"utf8");
  for(const name of ["ZhidaoOfficialPlayerPanel","ZhidaoPlayerMonitor","ZhidaoPlayerSettingsPanel"]){
    assert.ok(!fs.existsSync(path.join(root,"frontend/src/components",name+".tsx")));
    assert.ok(!app.includes(name));
  }
  assert.doesNotMatch(app,/renderZhidaoModeSwitch|zhidaoPlaybackMode/);
});

test("retired external launcher and frontend player preference errors stay absent",()=>{
  const bridge=fs.readFileSync(path.join(root,"frontend/src/bridge.ts"),"utf8");
  assert.doesNotMatch(native,/\blaunch_zhidao_legacy\b/);
  assert.doesNotMatch(bridge,/\b(openLegacyZhidao|launch_zhidao_legacy|PLAYER_SETTINGS_UNAVAILABLE|INVALID_PLAYER_SETTINGS)\b/);
  assert.match(bridge,/export function zhidaoQrCommand/);
  assert.match(native,/zhidao_open_official_site/);
});
