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


test("Zhidao course detail restores knowledge points and shared-video records",()=>{
 const detail=source("components/ZhidaoCourseDetailPanel.tsx");
 const bridge=source("bridge.ts");
 assert.match(detail,/zhidao\.course\.detail/);
 assert.match(detail,/knowledge-point|知识点/);
 assert.match(detail,/server_completed/);
 assert.match(bridge,/ZhidaoCourseDetail/);
});


test("first-run consent blocks the desktop until both legal documents are loaded and accepted",()=>{
 const gate=source("components/StudyFlowConsentGate.tsx");
 const app=source("App.tsx");
 assert.match(gate,/studyflow\.consent\.status/);
 assert.match(gate,/studyflow\.consent\.accept/);
 assert.match(gate,/我已阅读并同意/);
 assert.match(gate,/zhidao\.document\.read/);
 assert.match(app,/StudyFlowConsentGate desktop=\{desktop\}/);
});
