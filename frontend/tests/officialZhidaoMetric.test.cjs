const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");

const source=fs.readFileSync(path.join(__dirname,"../src/presentation.ts"),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={exports:{}};
new Function("module","exports","require",code)(mod,mod.exports,require);
const {presentCourse,courseMetric}=mod.exports;
const base={
 platform:"zhidao",course_id:"ai",title:"智慧课程",course_type:"ai",
 progress_evidence:"server_verified",verified_at:"2026-11-15T08:00:00Z"
};

test("AI schedule is named official server progress, independent of mastery",()=>{
 const course={...base,progress_percent:4,progress_metric:"official_ai_schedule"};
 assert.equal(presentCourse(course).percent,4);
 assert.match(presentCourse(course).detail,/schedule/);
 assert.equal(courseMetric(course).label,"知到课程进度");
});

test("fallback 4/147 remains explicitly named completed knowledge-point percentage",()=>{
 const course={...base,progress_percent:2.7,progress_metric:"knowledge_point_full"};
 assert.equal(presentCourse(course).percent,2.7);
 assert.equal(courseMetric(course).label,"满进度知识点占比");
 assert.match(presentCourse(course).detail,/不代表官方课程总进度/);
});

test("stale official schedule is never rendered as verified",()=>{
 const course={...base,progress_percent:4,progress_metric:"official_ai_schedule",stale:true};
 assert.equal(presentCourse(course).percent,null);
 assert.equal(presentCourse(course).status,"cached");
});

test("shared-video progress remains a separate metric",()=>{
 const course={...base,course_type:"shared",progress_percent:50,progress_metric:"completed_videos"};
 assert.equal(courseMetric(course).label,"已完成视频占比");
});
