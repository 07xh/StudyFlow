const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const source=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");

test("platform settings overlay preserves selected course workspace",()=>{
  const app=source("App.tsx"),dialog=source("ui/SettingsDialog.tsx");
  assert.match(app,/selected\?renderCourseWorkspace\(selected\):renderCourses\(platform\)/);
  assert.match(app,/<SettingsDialog open=\{platformSettingsOpen===platform\}/);
  for(const name of ["account","parameters","advanced"])assert.match(app,new RegExp('platformSettingsSection==="'+name+'"'));
  assert.match(dialog,/createPortal\(/);
  assert.match(dialog,/aria-modal="true"/);
  assert.match(dialog,/event.key==="Escape"/);
  assert.match(dialog,/lastFocus.current\?\.focus\(\)/);
});
test("course and platform parameter controls open a shared dialog without unmounting the runner",()=>{
  const zhs=source("components/ZhsTaskSettingsPanel.tsx");
  const ykt=source("components/YuketangTaskArea.tsx");
  const legacy=source("components/LegacyPlaybackPanel.tsx");
  assert.match(zhs,/<SettingsDialog open=\{opened\}/);
  assert.match(ykt,/<SettingsDialog open=\{settingsOpen\}/);
  assert.match(ykt,/view!=="settings"&&<LegacyPlaybackPanel/);
  assert.match(legacy,/<ZhsTaskSettingsPanel/);
  assert.match(legacy,/startUnavailableReason/);
  assert.doesNotMatch(ykt,/settings-open"\),String\(settingsOpen\)/);
});
test("course activity and diagnostics open separately from running controls",()=>{
  const app=source("App.tsx");
  assert.match(app,/<SettingsDialog open=\{courseLogsOpen\}/);
  assert.match(app,/title=\{course.title\+" · 日志与诊断"\}/);
  assert.doesNotMatch(app,/id=\{scope\+"logs"\}/);
});
