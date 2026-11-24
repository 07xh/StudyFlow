const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,"../src",name),"utf8");
const app=read("App.tsx");
const css=read("ui/foundation.css");
test("course workspace has one compact content heading and a back action",()=>{
 const workspace=app.slice(app.indexOf("const renderCourseWorkspace="),app.indexOf("const activeSelectedCourse="));
 assert.match(workspace,/className="sf-course-context"/);
 assert.match(workspace,/<h2 title=\{course.title\}>\{course.title\}<\/h2>/);
 assert.match(workspace,/className="secondary sf-course-back"/);
 assert.doesNotMatch(workspace,/sf-course-playback-heading/);
 assert.match(css,/\.sf-course-context\{display:flex/);
 assert.match(css,/\.sf-course-context\{flex-basis:100%/);
});
test("four catalog panels share the resource heading and course-specific identity",()=>{
 const workspace=app.slice(app.indexOf("const renderCourseWorkspace="),app.indexOf("const activeSelectedCourse="));
 assert.equal((workspace.match(/title="课程章节与资源"/g)||[]).length,4);
 for(const platform of ["ucampus","xuexitong","yuketang"]) {
  assert.ok(workspace.includes('key={"'+platform+'-catalog:"+course.course_id}'));
 }
 assert.ok(workspace.includes('key={"chapters:"+course.course_id}'));
});
