const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const source=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");
test("official speed settings have custom input, presets, and save validation",()=>{
  const ui=source("components/ZhidaoPlayerSettingsPanel.tsx");
  assert.match(ui,/min=\{0\.5\} max=\{4\} step=\{0\.01\}/);
  assert.match(ui,/!speedValid/);
  assert.match(ui,/SPEED_PRESETS/);
  assert.match(source("bridge.ts"),/speed:string;allowMinimize/);
});
test("platform specific ranges remain distinct",()=>{
  assert.match(source("components/ZhsTaskSettingsPanel.tsx"),/min=\{1\} max=\{2\} step=\{0\.01\}/);
  assert.match(source("components/YuketangTaskArea.tsx"),/\["video_speed","视频倍速（0\.1–4×）",0\.1,4,0\.01\]/);
});

test("official player refreshes saved speed before every start and shows observed rate",()=>{
  const player=source("components/ZhidaoOfficialPlayerPanel.tsx");
  assert.match(player,/const current=await request<ZhidaoPlayerSettings>\(\{operation:"zhidao\.player\.settings\.get"\}\)/);
  assert.match(player,/speed:current\.speed/);
  assert.match(player,/status\.rate/);
  assert.match(player,/实际倍速/);
  assert.match(source("ui/foundation.css"),/sf-zd-player-settings input\[type="number"\]/);
});
