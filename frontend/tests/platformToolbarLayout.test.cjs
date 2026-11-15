const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");

test("platform toolbar keeps settings and sync in one ordered row without a duplicate course-list button",()=>{
  const app=source("App.tsx");
  const css=source("style.css");
  const block=app.slice(app.indexOf('className="sf-platform-toolbar actions"'),app.indexOf("platformSettingsOpen===platform?renderPlatformSettings(platform)"));
  assert.ok(block.length>0);
  const settings=block.indexOf("参数设置"),sync=block.indexOf("同步课程列表");
  assert.ok(settings>=0&&sync>settings,"settings and synchronization must stay in this order");
  assert.doesNotMatch(block,/打开课程列表/,"the platform landing already contains the course list");
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

test("LightC frame puts global settings beside real window buttons and keeps platform row fixed",()=>{
  const shell=source("ui/AppShell.tsx");
  const css=source("ui/foundation.css");
  const windowConfig=JSON.parse(fs.readFileSync(path.join(__dirname,"..","..","src-tauri","tauri.conf.json"),"utf8"));
  const capabilities=JSON.parse(fs.readFileSync(path.join(__dirname,"..","..","src-tauri","capabilities","default.json"),"utf8"));
  assert.equal(windowConfig.app.windows[0].decorations,false,"Custom titlebar cannot coexist with native titlebar");
  for(const permission of ["core:window:allow-close","core:window:allow-minimize","core:window:allow-toggle-maximize","core:window:allow-start-dragging"])
    assert.ok(capabilities.permissions.includes(permission));
  assert.match(shell,/data-tauri-drag-region/);
  assert.match(shell,/sf-window-titlebar-actions/);
  assert.equal((shell.match(/sf-settings-button/g)||[]).length,1,"Global settings must not repeat in second row");
  assert.match(shell,/getCurrentWindow\(\)\.minimize\(\)/);
  assert.match(shell,/getCurrentWindow\(\)\.toggleMaximize\(\)/);
  assert.match(shell,/getCurrentWindow\(\)\.close\(\)/);
  assert.match(shell,/sf-workspace-empty-progress/);
  assert.match(css,/grid-template-rows:34px auto minmax\(0,1fr\)/);
  assert.match(css,/\.sf-shell \.sf-workspace-header\{[\s\S]*?grid-column:1\/-1;grid-row:2/);
  assert.match(css,/\.sf-shell \.main\{[\s\S]*?grid-column:2;grid-row:3/);
  assert.match(css,/overflow-y:auto;overscroll-behavior:contain/);
});
