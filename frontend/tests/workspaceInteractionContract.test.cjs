const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,"../src",name),"utf8");
const app=read("App.tsx");
const shell=read("ui/AppShell.tsx");

test("UCampus participates in the shared platform header",()=>{
  assert.match(app,/headerPlatform:Platform\|null=.*page==="platform-ucampus"\?"ucampus":null/);
  assert.match(app,/currentPlatformStatus=\{headerPlatform\?platforms\[headerPlatform\]\.status/);
  assert.match(app,/courseOptions=\{headerPlatform\?platforms\[headerPlatform\]\.courses/);
});

test("course search is scoped to the platform and not reset by returning to its list",()=>{
  assert.match(app,/courseQueries\[platform\]/);
  assert.match(app,/setCourseQueries\(previous=>\(\{\.\.\.previous,\[platform\]:value\}\)\)/);
  const navigation=app.slice(app.indexOf("function enterCourses("),app.indexOf("function goPlatform("));
  assert.doesNotMatch(navigation,/setCourseQueries|setQuery/);
});

test("local log removal requires explicit confirmation",()=>{
  assert.match(app,/onClick=\{\(\)=>setClearLogsOpen\(true\)\}/);
  assert.match(app,/<ConfirmDialog open=\{clearLogsOpen\}/);
  assert.match(app,/onConfirm=\{\(\)=>\{setActivity\(\[\]\);try\{window\.localStorage\.removeItem\(ACTIVITY_KEY\)/);
  assert.match(app,/onCancel=\{\(\)=>setClearLogsOpen\(false\)\}/);
});

test("connection refresh has busy feedback and blocks duplicate clicks",()=>{
  assert.match(app,/refreshBusy=\{Boolean\(busy\)\} refreshing=\{busy==="status"\}/);
  assert.match(shell,/aria-busy=\{refreshing\} disabled=\{!desktop\|\|refreshBusy\}/);
});
