const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const repo=relative=>fs.readFileSync(path.join(__dirname,"..","..",relative),"utf8");

test("all Zhidao mastery operations use persistent sidecar, preserving background thread and exam drafts",()=>{
  const rust=repo("src-tauri/src/lib.rs");
  const i=rust.indexOf("let is_persistent =");
  const j=rust.indexOf("if is_persistent {",i);
  assert.ok(i>0&&j>i);
  const classification=rust.slice(i,j);
  assert.match(classification,/op\.starts_with\("zhidao\.mastery\."\)/,
    "one-shot sidecar exits after start and kills the daemon before it can run");
  assert.match(rust.slice(j,j+1050),/QrBridgeWorker::start/);
});

test("full-auto mastery launcher is visible in Zhidao course toolbar without expanding hidden section",()=>{
  const app=repo("frontend/src/App.tsx");
  const workspace=app.slice(app.indexOf("const renderCourseWorkspace="),app.indexOf("const activeSelectedCourse="));
  assert.match(workspace,/sf-course-top-actions[\s\S]*sf-course-mastery-action/);
  assert.match(workspace,/全自动掌握度/);
  assert.match(workspace,/setMasteryDialogCourseKey\(course\.course_id\)/);
  assert.match(workspace,/<MasteryAutoPanel/);
  assert.match(workspace,/open=\{masteryDialogCourseKey===course\.course_id\}/);
  assert.doesNotMatch(workspace,/\{course\.platform==="zhidao"&&<MasteryAutoPanel/,
    "auto worker must be opened from one dialog, not duplicated in hidden manual folds");
});

test("unsupported course types display a clear message, not a dead Start button",()=>{
  const app=repo("frontend/src/App.tsx");
  assert.match(app,/course\.course_type==="ai"[\s\S]*<MasteryAutoPanel/);
  assert.match(app,/当前课程不能启动 AI 掌握度自动练习/);
});
