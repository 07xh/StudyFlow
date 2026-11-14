const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("dashboard contains working data surfaces without a promotional hero", () => {
  const app = read("src/App.tsx");
  assert.match(app, /className="metrics sf-metrics"/);
  assert.match(app, /renderPlatforms\(\)/);
  assert.match(app, /renderCourses\(true\)/);
  assert.doesNotMatch(app, /让学习井然有序|sf-hero-hint|studyflow-footer|className="hero"/);
});

test("sidebar navigation remains interactive and grouped", () => {
  const shell = read("src/ui/AppShell.tsx");
  assert.match(shell, /workspaceNavigation/);
  assert.match(shell, /systemNavigation/);
  assert.match(shell, /onNavigate\(item\.id\)/);
  assert.match(shell, /setCollapsed/);
  assert.match(shell, /onThemeToggle/);
});

test("the shell uses the graphite glass skin and green interaction accent", () => {
  const css = read("src/ui/foundation.css");
  assert.match(css, /backdrop-filter:blur/);
  assert.match(css, /--accent:#13d992/);
  assert.match(css, /linear-gradient/);
  assert.match(css, /\.sf-shell\.sf-collapsed \.sidebar/);
});

test("platform login, original task controls and real IPC actions remain wired", () => {
  const app = read("src/App.tsx");
  const playback = read("src/components/LegacyPlaybackPanel.tsx");
  assert.match(app, /ZhidaoQrDialog/);
  assert.match(app, /LegacyPlaybackPanel platform="zhidao"/);
  assert.match(app, /LegacyPlaybackPanel platform="yuketang"/);
  assert.match(app, /fetchCoursesFromDesktop/);
  assert.match(app, /yuketang\.configure/);
  assert.match(playback, /startLegacy/);
  assert.match(playback, /stopLegacy/);
  assert.match(playback, /getLegacyStatus/);
});


test("QR login dialog follows the selected app theme outside the shell", () => {
  const app = read("src/App.tsx");
  const qr = read("src/ZhidaoQrDialog.tsx");
  const css = read("src/ui/foundation.css");
  assert.match(app, /ZhidaoQrDialog dark=\{dark\}/);
  assert.match(qr, /data-theme=\{dark\?"dark":"light"\}/);
  assert.match(css, /qr-backdrop\[data-theme="dark"\]/);
  assert.match(css, /qr-backdrop\[data-theme="light"\]/);
});
