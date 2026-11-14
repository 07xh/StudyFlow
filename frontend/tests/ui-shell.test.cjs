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
  assert.match(app,/<LegacyPlaybackPanel platform=\{platform\}/);
  assert.match(playback,/startLegacy/);
  assert.match(playback,/stopLegacy/);
  assert.match(playback,/getLegacyStatus/);
});

test("Zhidao QR dialog stays themed and platform-owned",()=>{
  const app=read("src/App.tsx");
  const qr=read("src/ZhidaoQrDialog.tsx");
  assert.match(app,/ZhidaoQrDialog dark=\{dark\}/);
  assert.match(qr,/data-theme=\{dark\?"dark":"light"\}/);
  assert.match(app,/if\(platform==="zhidao"\)return <ZhidaoLoginPanel/);
});
