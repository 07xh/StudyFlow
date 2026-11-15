const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const code = fs.readFileSync(path.join(__dirname, "../src/components/UpdatePanel.tsx"), "utf8");

test("updater keeps verified downloaded installer visible on check failure", () => {
  const check = code.slice(code.indexOf("async function check("), code.indexOf("  useEffect("));
  assert.ok(!check.includes('setDownloaded("")'));
  assert.ok(check.includes('setMessage(preference.channel==="stable"'));
  assert.ok(code.includes("不会自动安装"));
  assert.ok(code.includes("GitHub 官方发布页"));
});

test("new installations use beta channel while published builds are candidates", () => {
  assert.ok(code.includes('useState<UpdateSettings>({channel:"beta",mode:"download"})'));
});

test("release page action is routed to the default browser on Windows", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const rust = fs.readFileSync(path.join(__dirname, "../../src-tauri/src/lib.rs"), "utf8");
  assert.match(code, /onClick=\{event=>void openOfficialReleasePage\(event\)\}/);
  assert.match(code, /invoke\("studyflow_open_releases"\)/);
  assert.match(code, /无法打开系统浏览器，请手动访问/);
  assert.match(rust, /fn studyflow_open_releases\(\)/);
  assert.match(rust, /Command::new\("explorer.exe"\)/);
  assert.match(rust, /studyflow_exit, updates_open_folder, studyflow_open_releases,/);
  assert.match(rust, /https:\/\/github\.com\/07xh\/StudyFlow\/releases/);
});
