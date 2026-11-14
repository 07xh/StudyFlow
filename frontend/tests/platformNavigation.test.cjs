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
 const stored=Array.from(panel.matchAll(/localStorage\.setItem\(([^;]+)\);/g),m=>m[1]);
 assert.deepEqual(stored,['"studyflow.yuketang.settings-open",String(settingsOpen)']);
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


test("LightC-style left rail is compact, permanent, and keeps settings in the header",()=>{
 const shell=source("ui/AppShell.tsx");
 const css=source("ui/foundation.css");
 assert.match(shell,/<aside className="sf-floating-nav" aria-label="主导航">/);
 assert.match(shell,/sf-settings-button/);
 assert.match(shell,/setPlatformExpanded/);
 assert.match(css,/grid-template-columns:clamp\(172px,16vw,202px\) minmax\(0,1fr\)/);
 assert.match(css,/grid-template-columns:144px minmax\(0,1fr\)/);
 assert.match(css,/position:sticky/);
 assert.match(css,/\.sf-shell \.sf-floating-nav \.nav/);
 assert.doesNotMatch(shell,/PanelLeft|handleTriggerClick|onPointerEnter/);
 assert.doesNotMatch(css,/sf-floating-nav__trigger|sf-floating-nav__panel/);
});

test("course details use one foldable workspace and show total progress only in the header",()=>{
 const app=source("App.tsx");
 const lesson=source("components/ZhidaoCourseDetailPanel.tsx");
 const server=source("components/ZhidaoProgressPanel.tsx");
 const simulation=source("components/LegacyPlaybackPanel.tsx");
 const player=source("components/ZhidaoOfficialPlayerPanel.tsx");
 const log=source("components/ZhidaoActivityPanel.tsx");
 const yuketang=source("components/YuketangTaskArea.tsx");
 const css=source("ui/foundation.css");
 assert.match(app,/renderCourseWorkspace/);
 assert.doesNotMatch(app,/sf-course-total-progress/);
 assert.match(app,/<CollapsibleSection id={scope\+"runtime"}/);
 assert.match(app,/headerTitle=\{workspaceCourse\?"课程详情":undefined\}/);
 assert.match(app,/courseProgress=\{activeCourseProgress\}/);
 assert.match(app,/activeSelectedCourse/);
 assert.match(app,/<ZhidaoActivityPanel embedded events=/);
 assert.match(app,/courseId=\{course\.course_id\}.*detailMode/s);
 assert.match(lesson,/zhidao\.course\.detail/);
 assert.match(lesson,/章节进度/);
 assert.doesNotMatch(lesson,/detail\.percent\.toFixed/);
 assert.match(server,/courseId\?:string/);
 assert.match(server,/detailMode/);
 assert.match(simulation,/sf-detail-simulation-only/);
 assert.match(simulation,/courseId\?:string/);
 assert.match(player,/sf-zd-local-observations/);
 assert.match(player,/detailMode/);
 assert.match(log,/expandedByDefault/);
 assert.doesNotMatch(yuketang,/open=\{detailMode\}/);
 assert.match(simulation,/sf-detail-live/);
 assert.match(css,/sf-ykt-live\.sf-detail-live \.sf-ykt-live-grid/);
 assert.match(css,/\.sf-course-workspace>section\{margin:0\}/);
 assert.match(css,/\.sf-workspace-header/);
 assert.match(css,/\.sf-fold-body\[hidden\]/);
 assert.match(css,/sf-zd-detail-list-expanded/);
});


test("logout clears the selected course workspace for the affected platform",()=>{
 const app=source("App.tsx");
 assert.ok(app.includes('setSelectedCourse(previous=>previous?.platform===platform?null:previous);'));
 assert.ok(app.includes('await request<{cleared:boolean}>({operation:"yuketang.clear"});\n      invalidatePlatform("yuketang",true);'));
 assert.ok(app.includes('      await refresh();\n      setNotice("已清除学序保存的雨课堂凭据；原版客户端不受影响。");'));
 assert.match(app,/function invalidatePlatform\(platform:Platform, resetStatus = false\)/);
 assert.match(app,/resetStatus\s*\?\s*initialPlatforms\[platform\]\s*:\s*\{\.\.\.previous\[platform\],courses:\[\]\}/);
 assert.ok(app.includes('onDataChanged={()=>{invalidatePlatform("zhidao");void refresh();}}'));
});
