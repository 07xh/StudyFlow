const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const source=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");
test("official speed settings have custom input, presets, and save validation",()=>{
  const ui=source("components/ZhidaoPlayerSettingsPanel.tsx");
  assert.match(ui,/type="text" inputMode="decimal"/);
  assert.match(ui,/onKeyDown=\{event=>\{if\(event.key==='Enter'/);
  assert.match(ui,/normalizePlayerSpeedInput/);
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
  assert.match(source("ui/foundation.css"),/sf-zd-player-settings input\.sf-zd-speed-input/);
});

const loadSource=require("./helpers/load.cjs");
const {normalizePlayerSpeedInput}=loadSource("playerSpeed.ts");
test("keyboard input accepts decimals and normalizes only at commit",()=>{
  for(const [draft,expected] of Object.entries({
    "0.5":"0.5","0.75":"0.75",".75":"0.75","1.":"1","1.25":"1.25",
    "2.35":"2.35","3.50":"3.5","4.00":"4"," 2.75 ":"2.75"
  }))assert.equal(normalizePlayerSpeedInput(draft),expected,draft);
  for(const draft of ["","0","0.","0.49","4.01","4.001","1.234","1e2","-1","NaN",".","abc","01","２"])
    assert.equal(normalizePlayerSpeedInput(draft),null,draft);
});
test("keyboard editing does not coerce incomplete input or save invalid speed",()=>{
  const ui=source("components/ZhidaoPlayerSettingsPanel.tsx");
  assert.match(ui,/update\('speed',event.currentTarget.value\)/);
  assert.match(ui,/setSpeedTouched\(false\)/);
  assert.match(ui,/settings:\{\.\.\.draft,speed:canonicalSpeed,mode:current.mode\}/);
  assert.match(ui,/!speedValid&&speedTouched/);
});
