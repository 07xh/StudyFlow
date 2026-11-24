const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");

test("course workspace leads with controls and retains platform-wide Rain Classroom warning",()=>{
  const app=read("App.tsx");
  const course=app.slice(app.indexOf("const renderCourseWorkspace="),app.indexOf("const activeSelectedCourse="));
  assert.doesNotMatch(course,/在这里管理播放与查看真实章节/);
  assert.match(course,/sf-course-scope-note/);
  assert.match(course,/当前课堂范围可能包含其他课程/);
  assert.match(course,/当前范围与「\{course.title\}」不一定相同/);
  assert.match(course,/sf-course-playback-stage/);
});

test("provider settings retain parameters and hide long help behind accessible details",()=>{
  const zhs=read("components/ZhsTaskSettingsPanel.tsx");
  const ykt=read("components/YuketangTaskArea.tsx");
  for(const name of ["执行参数","执行范围","阈值与倍速说明","范围与续播说明"])assert.ok(zhs.includes(name));
  for(const name of ["播放参数","完成规则","阈值说明","参数作用范围"])assert.ok(ykt.includes(name));
  assert.match(zhs,/保存参数/);
  assert.match(ykt,/保存参数与课堂阈值/);
});

test("chapter records preserve verification detail without stacking permanent notice text",()=>{
  const zd=read("components/ZhidaoCourseDetailPanel.tsx");
  const ykt=read("components/YuketangCourseDetailPanel.tsx");
  assert.match(zd,/CourseRecordToolbar/);
  assert.match(ykt,/CourseRecordToolbar/);
  assert.match(ykt,/sf-record-verification-meta/);
  assert.match(ykt,/sf-record-pending/);
  assert.match(ykt,/核验摘要/);
  assert.match(ykt,/尚无服务器确认记录/);
});

test("search UX and matching remain unchanged by text cleanup",()=>{
  const app=read("App.tsx");
  const toolbar=read("ui/CourseRecordViews.tsx");
  assert.match(app,/course\.title\.toLocaleLowerCase\(\)\.includes\(search\)/);
  assert.match(app,/course\.course_id\.toLocaleLowerCase\(\)\.includes\(search\)/);
  assert.match(toolbar,/onClick=\{toggleSearch\}/);
  assert.match(toolbar,/onChange=\{event=>onSearch\(event.target.value\)\}/);
  assert.match(toolbar,/onClick=\{\(\)=>onSearch\(""\)\}/);
});
