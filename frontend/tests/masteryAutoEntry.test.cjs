const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const read=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");
const app=read("App.tsx");
const start=app.indexOf("const renderCourseWorkspace=");
const end=app.indexOf("const activeSelectedCourse=",start);
const workspace=app.slice(start,end);

test("Zhidao course toolbar exposes full-auto mastery launch without scrolling or unfolding",()=>{
  const toolbar=workspace.slice(workspace.indexOf('className="sf-course-detail-topline"'),
    workspace.indexOf('className="sf-course-playback-heading"'));
  assert.match(toolbar,/course.platform==="zhidao"&&<button/);
  assert.match(toolbar,/全自动掌握度/);
  assert.match(toolbar,/onClick=\{\(\)=>setMasteryDialogCourseKey\(course.course_id\)\}/);
  assert.doesNotMatch(toolbar,/course.course_type==="ai"/,
    "Toolbar must not silently disappear for unrecognized course types");
});

test("one modal owns auto worker and reports non-AI courses, manual practice remains in fold",()=>{
  assert.match(workspace,/open=\{masteryDialogCourseKey===course.course_id\}/);
  assert.match(workspace,/course.course_type==="ai"\s*\?<MasteryAutoPanel/);
  assert.match(workspace,/尚未识别到这门课的 AI 课程类型/);
  assert.match(workspace,/标记为共享课/);
  assert.match(workspace,/<MasteryPanel /);
  assert.equal((workspace.match(/<MasteryAutoPanel\b/g)||[]).length,1,
    "Do not mount two auto panels for the same course");
  assert.match(workspace,/配置并启动全自动/);
});

test("background worker stays independent of dialog lifecycle",()=>{
  const panel=read("components/MasteryAutoPanel.tsx");
  assert.match(panel,/masteryAutoStatus\(courseKey\)/);
  assert.match(panel,/masteryAutoStart\(courseKey,options\)/);
  assert.match(panel,/masteryAutoControl\(courseKey,action\)/);
  assert.match(panel,/开始全部章节/);
});
