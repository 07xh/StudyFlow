const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");

test("ZHS direct controls are present on the Zhidao platform page", () => {
  const app = read("App.tsx");
  assert.match(app, /sf-zhidao-direct-task/);
  assert.match(app, /<LegacyPlaybackPanel platform="zhidao" courses=\{platforms\.zhidao\.courses\}/);
  assert.match(app, /onCourseVerified=\{updateVerifiedZhidaoCourse\}/);
  assert.match(app, /zhidaoPlaybackMode==="official"&&<ZhidaoPlayerSettingsPanel/);
  assert.match(app, /<CollapsibleSection id="platform:zhidao:defaults".*defaultExpanded=\{false\}>/);
  assert.match(app, /const \[zhidaoPlaybackMode,setZhidaoPlaybackMode\]=useState<"official"\|"zhs-original">\("zhs-original"\)/);
});

test("ZHS course choice precedes the start button and does not require WebView2", () => {
  const panel = read("components/LegacyPlaybackPanel.tsx");
  const picker = panel.indexOf('className="legacy-field sf-zhs-course-selector"');
  const actions = panel.indexOf('className="actions legacy-actions"');
  assert.ok(picker > 0 && picker < actions);
  assert.match(panel, /开始 ZHS 任务/);
  assert.match(panel, /停止 ZHS 任务/);
  assert.match(panel, /setSelection\(e.target.value\);setZhsOptions\(null\)/);
  assert.match(panel, /startLegacy\(platform/);
  assert.doesNotMatch(panel, /zhidao_player_start|WebView2.*invoke/);
});

test("ZHS and official playback keep separate runtime entry points", () => {
  const zhs = read("components/LegacyPlaybackPanel.tsx");
  const official = read("components/ZhidaoOfficialPlayerPanel.tsx");
  assert.match(zhs, /getLegacyStatus/);
  assert.match(zhs, /startLegacy/);
  assert.match(official, /invoke<PlayerStatus>\("zhidao_player_start"/);
});
