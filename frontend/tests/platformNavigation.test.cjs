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
 assert.match(app,/platformLoginExpanded/);
 assert.match(app,/Record<Platform,boolean>/);
 assert.match(app,/expanded=\{platformLoginExpanded\[platform\]\}/);
 assert.match(app,/onToggleLogin=\{\(\)=>setPlatformLoginExpanded\(previous=>\(\{\.{3}previous,\[platform\]:!previous\[platform\]\}\)\)\}/);
 assert.doesNotMatch(app,/openLegacyZhidao|openZhidao\(/);
 assert.match(app,/YuketangLoginPanel/);
 assert.match(app,/ZhidaoLoginPanel/);
 assert.match(app,/ZhidaoOfficialPlayerPanel/);
 assert.match(app,/LegacyPlaybackPanel platform="zhidao"/);
 assert.match(app,/YuketangTaskArea courses=\{platforms\.yuketang\.courses\}/);
 const yuketang=source("components/YuketangTaskArea.tsx");
 assert.match(yuketang,/<LegacyPlaybackPanel platform="yuketang"/);
 assert.match(app,/onImported=/);
 assert.match(app,/ZhidaoAccountTools/);
 assert.match(app,/ZhidaoProgressPanel/);
 const monitor=source("components/ZhidaoPlayerMonitor.tsx");
 assert.match(app,/consentAccepted&&<ZhidaoPlayerMonitor/);
 assert.match(monitor,/zhidao\.progress\.verify/);
 assert.match(monitor,/1000/);
});

test("original settings and cookie import use the Python bridge instead of localStorage",()=>{
 const panel=source("components/YuketangTaskArea.tsx");
 const legacy=source("components/LegacyPlaybackPanel.tsx");
 const login=source("components/ZhidaoMigration.tsx");
 assert.match(panel,/yuketang.settings.get/);
 assert.match(panel,/yuketang.settings.save/);
 assert.match(panel,/LegacyPlaybackPanel platform="yuketang"/);
 assert.doesNotMatch(panel,/localStorage/);
 assert.doesNotMatch(legacy,/localStorage/);
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


test("first-run consent uses native bundled resources and blocks the desktop until accepted",()=>{
 const gate=source("components/StudyFlowConsentGate.tsx");
 const app=source("App.tsx");
 assert.match(gate,/studyflow_consent_status/);
 assert.match(gate,/studyflow_consent_accept/);
 assert.match(gate,/studyflow_read_document/);
 assert.match(gate,/点击“同意并继续使用”即表示你已阅读并同意/);
 assert.doesNotMatch(gate,/type="checkbox"/);
 assert.match(gate,/退出学序/);
 assert.match(gate,/studyflow_exit/);
 assert.doesNotMatch(gate,/studyflow\.consent\.status|studyflow\.consent\.accept|zhidao\.document\.read/);
 assert.match(app,/StudyFlowConsentGate desktop=\{desktop\}/);
 assert.match(app,/consentAccepted&&<ZhidaoPlayerMonitor/);
});


test("LightC AnchorNav pattern stays compact, floating, and keeps settings in the header",()=>{
 const shell=source("ui/AppShell.tsx");
 const css=source("ui/foundation.css");
 assert.match(shell,/PanelLeft/);
 assert.match(shell,/sf-settings-button/);
 assert.match(shell,/onPointerEnter=\{handlePointerEnter\} onPointerLeave=\{handlePointerLeave\}/);
 assert.doesNotMatch(shell,/systemNavigation|sf-floating-nav__brand/);
 assert.match(css,/\.sf-floating-nav__trigger\{\s*position:fixed;\s*left:12px;\s*top:50%;\s*width:32px;\s*height:32px;/);
 assert.ok(css.includes("padding:20px clamp(18px,2.4vw,34px) 26px 58px;"));
 assert.ok(css.includes("padding:15px 13px 20px 52px"));
 assert.match(shell,/function handleTriggerClick\(\)\{\s*setNavOpen\(current=>!current\);\s*\}/);
 assert.match(css,/left:12px/);
 assert.match(css,/width:max-content/);
 assert.match(css,/min-width:132px/);
 assert.match(css,/padding-left:clamp\(18px,2\.4vw,34px\)/);
});
