const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=p=>fs.readFileSync(path.join(__dirname,"..","src",p),"utf8");

test("new graphite shell keeps dedicated sidebar pages",()=>{
 const shell=source("ui/AppShell.tsx");
 assert.match(shell,/platformNavigation/);
 assert.match(shell,/"platform-zhidao"/);
 assert.match(shell,/"platform-yuketang"/);
 assert.match(shell,/sf-subnav/);
 assert.match(shell,/setPlatformExpanded/);
});

test("new dashboard keeps platform-owned login and task panels",()=>{
 const app=source("App.tsx");
 assert.match(app,/page==="platform-zhidao"&&renderPlatformDetail\("zhidao"\)/);
 assert.match(app,/page==="platform-yuketang"&&renderPlatformDetail\("yuketang"\)/);
 assert.match(app,/renderPlatformLogin\(platform\)/);
 assert.match(app,/YuketangLoginPanel/);
 assert.match(app,/ZhidaoLoginPanel/);
 assert.match(app,/ZhidaoOfficialPlayerPanel/);
 assert.match(app,/LegacyPlaybackPanel platform="zhidao"/);
 assert.match(app,/LegacyPlaybackPanel platform="yuketang"/);
 assert.match(app,/onImported=/);
 assert.match(app,/ZhidaoAccountTools/);
 assert.match(app,/ZhidaoProgressPanel/);
});

test("original settings and cookie import use the Python bridge instead of localStorage",()=>{
 const panel=source("components/LegacyPlaybackPanel.tsx");
 const login=source("components/ZhidaoMigration.tsx");
 assert.match(panel,/yuketang.settings.get/);
 assert.match(panel,/yuketang.settings.save/);
 assert.doesNotMatch(panel,/localStorage/);
 assert.match(login,/zhidao.cookie.import/);
});
