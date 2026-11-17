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
  assert.ok(code.includes("GitHub 最新版"));
  assert.ok(code.includes("全部历史版本"));
});

test("new installations use beta channel while published builds are candidates", () => {
  assert.ok(code.includes('useState<UpdateSettings>({channel:"beta",mode:"download",source:"auto",fallback:true})'));
});

test("settings and new-version dialog both open official releases in the system browser",()=>{
  const nav=fs.readFileSync(path.join(__dirname,"../src/releaseNavigation.ts"),"utf8");
  const dialog=fs.readFileSync(path.join(__dirname,"../src/ui/ReleaseNotesDialog.tsx"),"utf8");
  const rust=fs.readFileSync(path.join(__dirname,"../../src-tauri/src/lib.rs"),"utf8");
  assert.match(code,/onClick=\{event=>void openLatestRelease\(event,setMessage\)\}/);
  assert.match(code,/onClick=\{event=>void openOfficialReleases\(event,setMessage\)\}/);
  assert.match(dialog,/onClick=\{event=>void openOfficialReleases\(event,setBrowserError\)\}/);
  assert.match(dialog,/browserError&&<p role="status"/);
  assert.match(nav,/if\(!isDesktop\(\)\)return/);
  assert.match(nav,/event.preventDefault\(\)/);
  assert.match(nav,/invoke\("studyflow_open_releases"\)/);
  assert.match(rust,/fn studyflow_open_releases\(tag: Option<String>\)/);
  assert.match(rust,/Command::new\("explorer.exe"\)/);
  assert.match(rust,/studyflow_exit, updates_open_folder, studyflow_open_releases,/);
});


test("mirror controls expose only packaged sources and safe failover",()=>{
  assert.ok(code.includes('operation:"updates.sources"'));
  assert.ok(code.includes('id="update-source"'));
  assert.ok(code.includes('id="update-fallback"'));
  assert.ok(code.includes('<option value="proxy" disabled={!sources.proxy}>国内公共 GitHub 代理</option>'));
});
