const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const load=require("./helpers/load.cjs");

const {compareVersions,decideLaunch,validVersion,shouldPromptForRelease}=load("versionLaunch.ts");
const read=p=>fs.readFileSync(path.join(__dirname,"../src",p),"utf8");

test("initial installation has no upgrade popup; legacy desktop data migrates with one prompt",()=>{
  assert.equal(decideLaunch("0.1.1-rc.16",null,false),"fresh");
  assert.equal(decideLaunch("0.1.1-rc.16",null,true),"upgrade");
  assert.equal(decideLaunch("0.1.1-rc.16","0.1.1-rc.16",true),"unchanged");
  assert.equal(decideLaunch("0.1.1-rc.16","v0.1.1-rc.16",true),"unchanged");
});
test("version detection compares RC identifiers numerically and rejects rollback prompts",()=>{
  assert.equal(compareVersions("0.1.1-rc.10","0.1.1-rc.9"),1);
  assert.equal(compareVersions("0.1.1","0.1.1-rc.99"),1);
  assert.equal(compareVersions("0.1.1-beta.10","0.1.1-beta.2"),1);
  assert.equal(compareVersions("0.2.0","0.1.9"),1);
  assert.equal(decideLaunch("0.1.1-rc.9","0.1.1-rc.10",true),"unchanged");
  assert.equal(validVersion("../../bad"),false);
  assert.equal(decideLaunch("../../bad","0.1.0",true),"unchanged");
});
test("startup modal is desktop-only, consent-gated, and remembers version on dismissal",()=>{
  const lifecycle=read("useReleaseChangelog.ts");
  const app=read("App.tsx");
  assert.match(lifecycle,/if\(!desktop\|\|!consentAccepted\)return;/);
  assert.match(lifecycle,/const choice=decideLaunch\(version,snapshot.previous,snapshot.existing\)/);
  assert.match(lifecycle,/if\(choice==="fresh"\)markVersionSeen\(version\)/);
  assert.match(lifecycle,/if\(choice==="upgrade"\)open\("startup",version/);
  assert.match(lifecycle,/if\(dialog\?\.scope==="startup"\)markVersionSeen\(dialog.version\)/);
  assert.match(lifecycle,/history:scope==="history"/);
  assert.match(app,/<ReleaseNotesDialog state=\{releaseChangelog.dialog\}/);
  assert.match(app,/onOpenChangelog=\{releaseChangelog.openHistory\}/);
});
test("changelog must be real release data and never inject remote HTML",()=>{
  const dialog=read("ui/ReleaseNotesDialog.tsx");
  const bridge=read("bridge.ts");
  const rust=fs.readFileSync(path.join(__dirname,"../../src-tauri/src/lib.rs"),"utf8");
  assert.match(dialog,/state.entries.map\(entry=>/);
  assert.match(dialog,/当前版本尚无可匹配的已发布更新说明/);
  assert.doesNotMatch(dialog,/dangerouslySetInnerHTML/);
  assert.match(dialog,/Github/i);
  assert.match(bridge,/operation: "updates.changelog"/);
  assert.match(rust,/"updates.changelog" if request.get\("current_version"\)/);
});

test("a published GitHub Release is only prompted when newer and not dismissed",()=>{
  assert.equal(shouldPromptForRelease("0.1.1-rc.17","v0.1.1-rc.18",null),true);
  assert.equal(shouldPromptForRelease("0.1.1-rc.17","v0.1.1-rc.18","v0.1.1-rc.17"),true);
  assert.equal(shouldPromptForRelease("0.1.1-rc.17","v0.1.1-rc.18","v0.1.1-rc.18"),false);
  assert.equal(shouldPromptForRelease("0.1.1-rc.18","v0.1.1-rc.18",null),false);
  assert.equal(shouldPromptForRelease("0.1.1-rc.18","v0.1.1-rc.17",null),false);
  assert.equal(shouldPromptForRelease("0.1.1-rc.17","unverified",null),false);
});
test("running desktop checks real releases and displays their body directly",()=>{
  const lifecycle=read("useReleaseChangelog.ts");
  const dialog=read("ui/ReleaseNotesDialog.tsx");
  const app=read("App.tsx");
  assert.match(lifecycle,/operation:"updates.check",current_version:currentVersion/);
  assert.match(lifecycle,/CHECK_INTERVAL_MS=20\*60\*1000/);
  assert.match(lifecycle,/window.addEventListener\("focus",checkPublishedRelease\)/);
  assert.match(lifecycle,/shouldPromptForRelease\(currentVersion,release.version,readDismissedRelease\(\)\)/);
  assert.match(lifecycle,/notes:release.notes/);
  assert.match(lifecycle,/markReleaseDismissed\(dialog.version\)/);
  assert.match(dialog,/发现新版本/);
  assert.match(dialog,/查看更新/);
  assert.match(app,/onOpenUpdates=\{\(\)=>\{releaseChangelog.close\(\);setPage\("settings"\);\}\}/);
});
test("installed upgrade changelog has bundled candidate fallback and retry",()=>{
  const lifecycle=read("useReleaseChangelog.ts");
  const bundled=read("packagedReleaseNotes.ts");
  const dialog=read("ui/ReleaseNotesDialog.tsx");
  assert.match(lifecycle,/bundledReleaseNotes\(version,previous,scope==="history"\)/);
  assert.match(bundled,/import.meta.glob<string>/);
  assert.match(bundled,/RELEASE_CANDIDATE_/);
  assert.match(dialog,/安装包内置的候选版更新说明/);
  assert.match(dialog,/重新获取/);
});

test("offline notes are actual bundled RC markdown, not fabricated",()=>{
  const {bundledReleaseNotes}=load("packagedReleaseNotes.ts");
  const installed=bundledReleaseNotes("0.1.1-rc.18");
  assert.equal(installed.length,1);
  assert.equal(installed[0].version,"v0.1.1-rc.18");
  assert.match(installed[0].notes,/雨课堂课程进度与平台总览/);
  const skipped=bundledReleaseNotes("0.1.1-rc.18","0.1.1-rc.16");
  assert.deepEqual(skipped.map(row=>row.version),["v0.1.1-rc.18","v0.1.1-rc.17"]);
});
