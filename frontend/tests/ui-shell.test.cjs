const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = relative => fs.readFileSync(path.join(__dirname,"..",relative),"utf8");

test("LightC-style slim navigation is always visible and reserves its own column", () => {
  const shell=read("src/ui/AppShell.tsx");
  const css=read("src/ui/foundation.css");
  for(const page of ["home","courses","tasks","platforms","records","logs"])
    assert.match(shell,new RegExp('id:"'+page+'"'));
  assert.match(shell,/sf-settings-button/);
  assert.match(shell,/id:"platform-zhidao"/);
  assert.match(shell,/id:"platform-yuketang"/);
  assert.match(shell,/platformExpanded/);
  assert.match(shell,/onNavigate\(item\.id\)/);
  assert.match(shell,/<aside className="sf-floating-nav" aria-label="主导航">/);
  assert.match(shell,/onRefresh/);
  assert.match(css,/--accent:#13d992/);
  assert.match(css,/\.app\.sf-shell\s*\{[^}]*display:grid;[^}]*grid-template-columns:clamp\(172px,16vw,202px\) minmax\(0,1fr\)/s);
  assert.match(css,/\.sf-shell \.sf-floating-nav\s*\{[^}]*position:sticky;/s);
  assert.match(css,/\.sf-shell \.main\s*\{[^}]*width:auto;/s);
  assert.match(css,/backdrop-filter:blur/);
  assert.match(css,/\.sf-shell \.sf-floating-nav \.sf-subnav/);
  assert.doesNotMatch(css,/sf-floating-nav__trigger|sf-floating-nav__panel/);
  assert.doesNotMatch(shell,/navOpen|setNavOpen|onPointerEnter|onPointerLeave|PanelLeft/);
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
  assert.match(app,/expanded=\{platformLoginExpanded\[platform\]\}/);
  assert.match(app,/onToggleLogin=\{\(\)=>setPlatformLoginExpanded\(previous=>\(\{\.{3}previous,\[platform\]:!previous\[platform\]\}\)\)\}/);
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


test("StudyFlow shared controls keep their own accessible interaction contracts",()=>{
  const toggle=read("src/ui/Switch.tsx");
  const empty=read("src/ui/EmptyState.tsx");
  const theme=read("src/ui/ThemeModeSelector.tsx");
  assert.match(toggle,/type="checkbox"/);
  assert.match(toggle,/role="switch"/);
  assert.match(toggle,/currentTarget\.checked/);
  assert.match(empty,/aria-live="polite"/);
  assert.match(empty,/aria-atomic="true"/);
  assert.match(empty,/sf-empty-action/);
  assert.match(theme,/role="group"/);
  assert.match(theme,/aria-pressed=\{mode==="light"\}/);
  assert.match(theme,/onChange\("dark"\)/);
  assert.match(theme,/onChange\("system"\)/);
  for(const source of [toggle,empty,theme])
    assert.doesNotMatch(source,/LightC-UI|Evan Lau/);
});

test("consent requires one explicit decision and keeps a single exit action", () => {
  const gate=read("src/components/StudyFlowConsentGate.tsx");
  const css=read("src/ui/foundation.css");
  assert.doesNotMatch(gate,/type="checkbox"/);
  assert.match(gate,/sf-consent-exit/);
  assert.match(gate,/点击“同意并继续使用”即表示你已阅读并同意/);
  assert.match(gate,/退出学序/);
  assert.match(gate,/同意并继续使用/);
  assert.match(css,/--accent-text:#078f5c/);
  assert.match(css,/sf-consent-confirmation/);
  assert.match(css,/sf-zd-progress-grid/);
  assert.match(css,/sf-zd-player-settings/);
});

test("platform controls keep independent settings and per-platform login expansion", () => {
  const app=read("src/App.tsx");
  const official=read("src/components/ZhidaoOfficialPlayerPanel.tsx");
  const progress=read("src/components/ZhidaoProgressPanel.tsx");
  const yuketang=read("src/components/YuketangTaskArea.tsx");
  assert.match(app,/Record<Platform,boolean>/);
  assert.match(app,/expanded=\{platformLoginExpanded\[platform\]\}/);
  assert.match(app,/\[platform\]:!previous\[platform\]/);
  assert.match(official,/update\("allowMinimize",checked\)/);
  assert.match(official,/update\("autoStart",checked\)/);
  assert.match(official,/update\("autoNext",checked\)/);
  assert.match(progress,/onChange=\{setMonitor\}/);
  assert.match(yuketang,/update\(id,event\.currentTarget\.checked\)/);
});


test("confirmation dialogs retain icon and primary action styling", () => {
  const css=read("src/ui/interactions.css");
  assert.match(css,/\.sf-dialog-symbol\s*\{/);
  assert.match(css,/\.sf-dialog-actions \.sf-dialog-confirm\s*\{/);
});
