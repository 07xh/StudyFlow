const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = name => fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");

test("platforms have dedicated second-level sidebar pages", () => {
  const shell = source("ui/AppShell.tsx");
  assert.match(shell, /"platform-zhidao"/);
  assert.match(shell, /"platform-yuketang"/);
  assert.match(shell, /sf-platform-subnav/);
  assert.match(shell, /onNavigate\(platform.id\)/);
});

test("all login and original parameters live inside their platform page", () => {
  const app = source("App.tsx");
  const start = app.indexOf('{page==="platforms"&&renderPlatforms()}');
  const z = app.indexOf('{page==="platform-zhidao"');
  const y = app.indexOf('{page==="platform-yuketang"');
  const settings = app.indexOf('{page==="settings"');
  assert.ok(start >= 0 && start < z && z < y && y < settings);
  const zSegment = app.slice(z,y);
  const ySegment = app.slice(y,settings);
  assert.match(zSegment, /ZhidaoLoginPanel/);
  assert.match(zSegment, /LegacyPlaybackPanel platform="zhidao"/);
  assert.match(ySegment, /credential-form/);
  assert.match(ySegment, /LegacyPlaybackPanel platform="yuketang"/);
  assert.equal((app.match(/<ZhidaoLoginPanel/g)||[]).length,1);
});

test("original YKT settings use the backend source of truth, not localStorage", () => {
  const panel = source("components/LegacyPlaybackPanel.tsx");
  assert.match(panel, /yuketang.settings.get/);
  assert.match(panel, /yuketang.settings.save/);
  assert.doesNotMatch(panel, /localStorage/);
});
