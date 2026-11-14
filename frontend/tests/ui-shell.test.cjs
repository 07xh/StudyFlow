const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = relative => fs.readFileSync(path.join(__dirname,"..",relative),"utf8");

test("LightC-style graphite sidebar has real platform child pages", () => {
  const shell=read("src/ui/AppShell.tsx");
  const css=read("src/ui/foundation.css");
  for(const page of ["home","courses","tasks","platforms","records","logs","settings"])
    assert.match(shell,new RegExp('id:"'+page+'"'));
  assert.match(shell,/id:"platform-zhidao"/);
  assert.match(shell,/id:"platform-yuketang"/);
  assert.match(shell,/platformExpanded/);
  assert.match(shell,/onNavigate\(item\.id\)/);
  assert.match(shell,/onRefresh/);
  assert.match(shell,/setCollapsed/);
  assert.match(css,/--accent:#13d992/);
  assert.match(css,/backdrop-filter:blur/);
  assert.match(css,/\.sf-shell\.sf-collapsed \.sidebar/);
  assert.match(css,/\.sf-shell \.sf-subnav/);
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
  assert.match(app,/<LegacyPlaybackPanel platform="yuketang"/);
  assert.match(playback,/startLegacy/);
  assert.match(playback,/stopLegacy/);
  assert.match(playback,/getLegacyStatus/);
  const official=read("src/components/ZhidaoOfficialPlayerPanel.tsx");
  assert.match(official,/zhidao_player_start/);
  assert.match(official,/zhidao.progress.verify/);
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
