const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = relative => fs.readFileSync(path.join(__dirname,"..",relative),"utf8");

test("LightC-style floating navigation overlays the workspace and keeps all page routes", () => {
  const shell=read("src/ui/AppShell.tsx");
  const css=read("src/ui/foundation.css");
  for(const page of ["home","courses","tasks","platforms","records","logs","settings"])
    assert.match(shell,new RegExp('id:"'+page+'"'));
  assert.match(shell,/id:"platform-zhidao"/);
  assert.match(shell,/id:"platform-yuketang"/);
  assert.match(shell,/platformExpanded/);
  assert.match(shell,/onNavigate\(item\.id\)/);
  assert.match(shell,/onPointerEnter=\{handlePointerEnter\}/);
  assert.match(shell,/onPointerLeave=\{handlePointerLeave\}/);
  assert.match(shell,/navPinned/);
  assert.match(shell,/setNavOpen\(true\)/);
  assert.match(shell,/Escape/);
  assert.match(shell,/aria-expanded=\{navOpen\}/);
  assert.match(shell,/aria-hidden=\{!navOpen\}/);
  assert.match(shell,/onFocusCapture/);
  assert.match(shell,/onBlurCapture/);
  assert.match(shell,/onRefresh/);
  assert.match(css,/--accent:#13d992/);
  assert.match(css,/\.sf-shell \.sf-floating-nav__panel\s*\{[^}]*position:fixed/s);
  assert.match(css,/\.app\.sf-shell\s*\{[^}]*display:block/s);
  assert.match(css,/\.sf-shell \.main\s*\{[^}]*width:100%/s);
  assert.match(css,/backdrop-filter:blur/);
  assert.match(css,/\.sf-shell \.sf-floating-nav__panel \.sf-subnav/);
  assert.doesNotMatch(css,/\.sf-shell \.sidebar\s*\{/);
  assert.doesNotMatch(css,/\.sf-shell\.sf-collapsed/);
  assert.doesNotMatch(shell,/className="sidebar"/);
  assert.doesNotMatch(shell,/studyflow\.nav\.collapsed|setCollapsed/);
});

test("dashboard only shows real course and server-verified live progress", () => {
  const app=read("src/App.tsx");
  assert.match(app,/fetchCoursesFromDesktop/);
  assert.match(app,/course\.progress_evidence==="server_verified"/);
  assert.match(app,/verified_at/);
  assert.match(app,/averageProgress===null\?"—"/);
  assert.doesNotMatch(app,/62%|8 门|5 门|3 门|\*\*\*\*1234/);
  assert.doesNotMatch(app,/studyflow-footer|让学习井然有序/);
});

test("platform task and original runtime APIs are retained", () => {
  const app=read("src/App.tsx");
  const playback=read("src/components/LegacyPlaybackPanel.tsx");
  assert.match(app,/page==="platform-zhidao"/);
  assert.match(app,/page==="platform-yuketang"/);
  assert.match(app,/renderPlatformDetail\("zhidao"\)/);
  assert.match(app,/renderPlatformDetail\("yuketang"\)/);
  assert.match(app,/<ZhidaoOfficialPlayerPanel/);
  assert.match(app,/<LegacyPlaybackPanel platform="zhidao"/);
  assert.match(app,/<YuketangTaskArea courses=\{platforms\.yuketang\.courses\}/);
  assert.match(app,/expanded=\{platformLoginExpanded\}/);
  assert.match(app,/onToggleLogin=\{\(\)=>setPlatformLoginExpanded\(value=>!value\)\}/);
  assert.doesNotMatch(app,/openLegacyZhidao|openZhidao\(/);
  const yuketang=read("src/components/YuketangTaskArea.tsx");
  assert.match(yuketang,/<LegacyPlaybackPanel platform="yuketang"/);
  assert.match(yuketang,/yuketang\.settings\.get/);
  assert.match(yuketang,/yuketang\.settings\.save/);
  assert.match(playback,/startLegacy/);
  assert.match(playback,/stopLegacy/);
  assert.match(playback,/getLegacyStatus/);
  const official=read("src/components/ZhidaoOfficialPlayerPanel.tsx");
  assert.match(official,/zhidao_player_start/);
  const monitor=read("src/components/ZhidaoPlayerMonitor.tsx");
  assert.match(monitor,/zhidao.progress.verify/);
  assert.match(monitor,/status.runId/);
  assert.match(official,/autoNext/);
});

test("Rain Classroom original progress has three distinct UI fields and a scoped IPC", () => {
  const view = read("src/components/LegacyPlaybackPanel.tsx");
  const bridge = read("src/bridge.ts");
  const task = read("src/legacyPlayback.ts");
  const rust = read("../src-tauri/src/legacy_tasks.rs");
  const router = read("../src-tauri/src/lib.rs");
  assert.match(view,/getYuketangLiveProgress\(next\.run_id\)/);
  assert.match(view,/simulation_percent/);
  assert.match(view,/server_percent/);
  assert.match(view,/processed/);
  assert.match(view,/并发模式下/);
  assert.match(task,/yuketang\.progress/);
  assert.match(bridge,/operation: "yuketang\.progress"/);
  assert.match(rust,/STUDYFLOW_YKT_RUN_ID/);
  assert.match(router,/yuketang\.progress/);
});

test("Zhidao QR dialog stays themed and platform-owned",()=>{
  const app=read("src/App.tsx");
  const qr=read("src/ZhidaoQrDialog.tsx");
  assert.match(app,/ZhidaoQrDialog dark=\{dark\}/);
  assert.match(qr,/data-theme=\{dark\?"dark":"light"\}/);
  assert.match(app,/if\(platform==="zhidao"\)return <ZhidaoLoginPanel/);
});

test("platform task status and verified progress are placed before login controls",()=>{
  const app=read("src/App.tsx");
  const playback=read("src/components/LegacyPlaybackPanel.tsx");
  const start=app.indexOf("const renderPlatformDetail=");
  const end=app.indexOf("async function configureFromPanel",start);
  const detail=app.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.ok(detail.indexOf("sf-platform-task-section")<detail.indexOf("sf-platform-detail"));
  assert.match(playback,/sf-live-progress-summary/);
  assert.match(playback,/presentCourse\(course\)/);
  assert.match(playback,/presentation\.percent !== null/);
  assert.doesNotMatch(playback,/Math\.random\(\)|setInterval\([^,]+,\s*[1-9]\)/);
});

test("first-run consent remains readable without Python sidecar and can exit on failure", () => {
  const gate=read("src/components/StudyFlowConsentGate.tsx");
  const router=read("../src-tauri/src/lib.rs");
  const config=read("../src-tauri/tauri.conf.json");
  const bridge=read("src/bridge.ts");
  assert.match(gate,/studyflow_consent_status/);
  assert.match(gate,/studyflow_read_document/);
  assert.match(gate,/studyflow_consent_accept/);
  assert.doesNotMatch(gate,/request<.*studyflow\.consent|zhidao\.document\.read/);
  assert.match(gate,/退出学序/);
  assert.match(gate,/studyflow_exit/);
  assert.match(router,/studyflow_consent_status/);
  assert.match(router,/studyflow_consent_accept/);
  assert.match(router,/studyflow_read_document/);
  assert.match(config,/legal\/使用条款与第三方声明\.txt/);
  assert.match(config,/legal\/隐私政策与数据说明\.txt/);
  assert.match(bridge,/BRIDGE_BINARY_MISSING/);
  assert.match(bridge,/BRIDGE_START_FAILED/);
});


test("verified Zhidao QR login closes the dialog and refreshes platform status", () => {
  const app = read("src/App.tsx");
  const qr = read("src/ZhidaoQrDialog.tsx");
  assert.match(qr, /if\(next\.stage==="verified"\)onVerifiedRef\.current\(\)/);
  const handlerStart = app.indexOf("onVerified=");
  const handlerEnd = app.indexOf("/>}", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = app.slice(handlerStart, handlerEnd);
  assert.match(handler, /setQrOpen\(false\)/);
  assert.match(handler, /void refresh\(\)/);
});
