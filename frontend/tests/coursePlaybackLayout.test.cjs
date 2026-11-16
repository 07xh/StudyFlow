const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");

test("course detail opens on playback controls without a fold gate",()=>{
  const app=read("App.tsx");
  const part=app.slice(app.indexOf("const renderCourseWorkspace="),app.indexOf("const activeSelectedCourse="));
  assert.match(part,/aria-label=\{catalogOnly\?"课程与任务工作台":"课程播放工作台"\}/);
  assert.match(part,/<section className="sf-course-playback-stage" aria-label=\{catalogOnly\?"任务模块状态":"播放控制"\}>/);
  assert.doesNotMatch(part,/id=\{scope\+"runtime"\}/,"running player must not be hidden behind a fold");
  assert.match(part,/view="player"[^>]*detailMode/,"Rain Classroom platform options should not repeat in the course player");
  assert.match(part,/title="章节与学习进度" defaultExpanded=\{true\}/);
  assert.match(part,/<SettingsDialog open=\{courseLogsOpen\}/);
});

test("platform-wide Rain Classroom executor is not presented as a selected-course player",()=>{
  const app=read("App.tsx");
  const part=app.slice(app.indexOf("const renderCourseWorkspace="),app.indexOf("const activeSelectedCourse="));
  assert.match(part,/雨课堂原版目前按已保存的课堂范围运行批量任务/);
  assert.match(part,/并非只针对/);
  assert.match(part,/openPlatformSettings\(course\.platform,"parameters"\)/);
});

test("platform management toolbar is hidden only while viewing a selected course",()=>{
  const app=read("App.tsx");
  const css=read("ui/foundation.css");
  assert.match(app,/!selected&&<div className="sf-platform-toolbar actions"/);
  assert.match(css,/\.sf-shell \.sf-course-playback-stage\{/);
  assert.match(css,/\.sf-shell \.sf-course-playback-stage \.legacy-playback-panel\{/);
});
