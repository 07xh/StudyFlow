const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");

test("platform toolbar keeps settings, course list and sync in one ordered row",()=>{
  const app=source("App.tsx");
  const css=source("style.css");
  const block=app.slice(app.indexOf('className="sf-platform-toolbar actions"'),app.indexOf("platformSettingsOpen===platform?renderPlatformSettings(platform)"));
  assert.ok(block.length>0);
  const settings=block.indexOf("参数设置"),courses=block.indexOf("打开课程列表"),sync=block.indexOf("同步课程列表");
  assert.ok(settings>=0&&courses>settings&&sync>courses,"buttons must stay in the intended order");
  assert.match(block,/role="group" aria-label="平台操作"/);
  assert.ok(block.includes("<SlidersHorizontal size={15}/>"));
  assert.match(css,/\.sf-shell \.sf-platform-toolbar\.actions\{[\s\S]*?flex-wrap:nowrap/);
  assert.match(css,/\.sf-shell \.sf-platform-toolbar\.actions>button\{[\s\S]*?white-space:nowrap/);
  assert.match(css,/\.sf-shell \.sf-platform-toolbar\.actions>button:first-child\{margin-left:auto\}/);
  assert.match(css,/overflow-x:auto/);
});

test("platform settings open separately without duplicating the main workspace controls",()=>{
  const app=source("App.tsx");
  const ykt=source("components/YuketangTaskArea.tsx");
  assert.match(app,/const renderPlatformSettings=\(platform:Platform\)=>/);
  assert.match(app,/platformSettingsOpen===platform\?renderPlatformSettings\(platform\)/);
  assert.match(app,/id="platform:zhidao:defaults"/);
  assert.match(app,/id="platform:zhidao:progress"/);
  assert.match(app,/id="platform:zhidao:data"/);
  assert.match(app,/<YuketangTaskArea view="settings"/);
  assert.match(app,/<YuketangTaskArea courses=\{platforms\.yuketang\.courses\} view="player"/);
  assert.match(ykt,/view\?:"both"\|"player"\|"settings"/);
  assert.match(ykt,/view!=="settings"&&<LegacyPlaybackPanel/);
  assert.match(ykt,/view!=="player"&&<div className="sf-inline-settings"/);
  assert.match(ykt,/view==="settings"\|\|settingsOpen/);
  assert.match(app,/id="platform:yuketang:tasks" title="平台批量任务"/);
});
