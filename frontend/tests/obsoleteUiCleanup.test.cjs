const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const src=p=>fs.readFileSync(path.join(__dirname,"..","src",p),"utf8");

test("only dedicated platform settings and selected course playback own Rain Classroom UI",()=>{
 const app=src("App.tsx"),area=src("components/YuketangTaskArea.tsx");
 assert.equal((app.match(/<YuketangTaskArea\b/g)||[]).length,2);
 assert.match(app,/<YuketangTaskArea[^>]+view="settings"/);
 assert.match(app,/<YuketangTaskArea[^>]+view="player"/);
 assert.match(area,/view\?:"player"\|"settings"/);
 assert.match(area,/if\(view==="player"\)return <LegacyPlaybackPanel/);
 assert.doesNotMatch(area,/settingsOpen|view="both"|<SettingsDialog|sf-inline-settings/);
 assert.match(area,/yuketang\.settings\.get/);
 assert.match(area,/yuketang\.settings\.save/);
});
test("advanced management links to existing tasks page instead of mounting duplicate executors",()=>{
 const app=src("App.tsx");
 const from=app.indexOf("const renderPlatformSettings=");
 const to=app.indexOf("const renderPlatformDetail=",from);
 assert.ok(from>0&&to>from);
 const settings=app.slice(from,to);
 assert.doesNotMatch(settings,/<RuntimeTaskList/);
 assert.doesNotMatch(settings,/<LegacyPlaybackPanel/);
 assert.doesNotMatch(settings,/id="platform:(zhidao|yuketang):tasks"/);
 assert.match(settings,/onClick=\{\(\)=>\{setPlatformSettingsOpen\(null\);setPage\("tasks"\);\}\}/);
 assert.match(app,/const renderTasks=\(\)=> <RuntimeTaskList/);
});
test("orphaned old inline player and route styles are removed",()=>{
 const shell=src("ui/foundation.css"),style=src("style.css");
 assert.doesNotMatch(shell,/sf-inline-settings>\.sf-yuketang-settings-panel/);
 assert.doesNotMatch(shell,/sf-inline-settings>\.sf-zd-player-settings/);
 assert.doesNotMatch(shell,/sf-inline-settings__toggle>svg:last-child\.is-open/);
 assert.doesNotMatch(style,/sf-platform-settings-action\.is-active/);
});
