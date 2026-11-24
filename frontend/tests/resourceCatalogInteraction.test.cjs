const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,"../src/components",name),"utf8");
const u=read("UCampusCourseDetailPanel.tsx");
const x=read("XuexitongPanels.tsx").split("export function XuexitongCourseDetailPanel")[1];
const css=read("XuexitongPanels.css");

test("UC campus unit search preserves original fallback numbering and distinguishes no match",()=>{
 assert.match(u,/units\.map\(\(unit,index\)=>\(\{unit,title:unit\.title\|\|"单元 "\+\(index\+1\)\}\)\)/);
 assert.match(u,/visibleUnits\.map\(\(\{unit,title\}\)/);
 assert.match(u,/没有符合搜索条件的单元/);
});
test("directory errors and loading are not presented as zero confirmed records",()=>{
 assert.match(u,/busy\?"正在读取单元…":error\?"单元读取失败"/);
 assert.match(x,/loading\?"正在读取章节…":chapterError\?"章节读取失败"/);
 assert.match(x,/chapterError&&<p role="alert">/);
 assert.match(u,/desktop&&!busy&&!error&&units\.length===0/);
});
test("switching resource groups clears old tasks synchronously",()=>{
 assert.match(u,/setTasks\(\[\]\);setTaskError\(""\);setTaskBusy\(next!==null\)/);
 assert.match(x,/setTasks\(\[\]\);setTaskError\(""\);setTaskLoading\(next!==null\)/);
 assert.match(u,/!taskBusy&&!taskError&&visible\.map/);
 assert.match(x,/!taskLoading&&!taskError&&visibleTasks\.map/);
});
test("catalog rows support required status and compact responsive layout",()=>{
 assert.match(css,/\.sf-xxt-task-item:has\(>small\)\{grid-template-columns:minmax\(64px,auto\) minmax\(0,1fr\) auto auto\}/);
 assert.match(css,/\.sf-xxt-task-item>small\{grid-column:2;justify-self:start\}/);
 assert.match(css,/border-bottom:1px solid var\(--line\)/);
});
