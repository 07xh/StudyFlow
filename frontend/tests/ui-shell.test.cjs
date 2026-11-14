const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("graphite shell keeps grouped navigation, theme and refresh controls interactive", () => {
  const shell = read("src/ui/AppShell.tsx");
  const css = read("src/ui/foundation.css");
  for (const page of ["home","courses","tasks","platforms","records","logs","settings"])
    assert.match(shell, new RegExp('id:"' + page + '"'));
  assert.match(shell, /onNavigate\(item\.id\)/);
  assert.match(shell, /onRefresh/);
  assert.match(shell, /setCollapsed/);
  assert.match(css, /--accent:#13d992/);
  assert.match(css, /backdrop-filter:blur/);
  assert.match(css, /\.sf-shell\.sf-collapsed \.sidebar/);
});

test("dashboard uses real platform data and only server-verified progress", () => {
  const app = read("src/App.tsx");
  assert.match(app, /fetchCoursesFromDesktop/);
  assert.match(app, /course\.progress_evidence==="server_verified"/);
  assert.match(app, /verified_at/);
  assert.match(app, /averageProgress===null\?"—"/);
  assert.doesNotMatch(app, /62%|8 门|5 门|3 门|\*\*\*\*1234|\*\*\*\*@edu\.cn/);
});

test("original Zhidao and Yuketang task processes remain connected", () => {
  const app = read("src/App.tsx");
  const playback = read("src/components/LegacyPlaybackPanel.tsx");
  assert.match(app, /LegacyPlaybackPanel platform="zhidao"/);
  assert.match(app, /LegacyPlaybackPanel platform="yuketang"/);
  assert.match(playback, /startLegacy/);
  assert.match(playback, /stopLegacy/);
  assert.match(playback, /getLegacyStatus/);
  assert.match(app, /page==="tasks"/);
});

test("QR login remains themed and platform-owned", () => {
  const app = read("src/App.tsx");
  const qr = read("src/ZhidaoQrDialog.tsx");
  assert.match(app, /ZhidaoQrDialog dark=\{dark\}/);
  assert.match(qr, /data-theme=\{dark\?"dark":"light"\}/);
  assert.match(app, /definition\.id==="zhidao"[\s\S]*<ZhidaoLoginPanel/);
});
