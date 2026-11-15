const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");

const src=fs.readFileSync(path.join(__dirname,"../src/progressMerge.ts"),"utf8");
const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const moduleRef={exports:{}};
new Function("module","exports","require",code)(moduleRef,moduleRef.exports,require);
const {mergeZhidaoEvidence}=moduleRef.exports;

const make=(time,percent,extra={})=>({
 platform:"zhidao",course_id:"same-course",title:"AI course",course_type:"ai",
 progress_percent:percent,progress_evidence:"server_verified",verified_at:time,
 session_marker:"a".repeat(64),...extra
});

test("older asynchronous course-list read cannot replace newer verified progress",()=>{
 const newest=make("2026-11-15T10:30:00+08:00",50);
 const older=make("2026-11-15T02:00:00Z",30);
 const [merged]=mergeZhidaoEvidence([newest],[older]);
 assert.equal(merged.progress_percent,50);
 assert.equal(merged.verified_at,newest.verified_at);
});

test("accept a real later server result even when its progress decreased",()=>{
 const old=make("2026-11-15T02:00:00Z",50);
 const newer=make("2026-11-15T02:30:00Z",30);
 const [merged]=mergeZhidaoEvidence([old],[newer]);
 assert.equal(merged.progress_percent,30);
 assert.equal(merged.verified_at,newer.verified_at);
});

test("do not resurrect evidence when the platform reports stale or unverified data",()=>{
 const old=make("2026-11-15T02:00:00Z",50);
 const stale=make("2026-11-15T01:00:00Z",20,{stale:true});
 const unverified=make(null,null,{progress_evidence:null});
 assert.deepEqual(mergeZhidaoEvidence([old],[stale]),[stale]);
 assert.deepEqual(mergeZhidaoEvidence([old],[unverified]),[unverified]);
});

test("verification timestamps are compared as instants, not strings",()=>{
 const old=make("2026-11-15T10:00:00+08:00",40);
 const newRecord=make("2026-11-15T02:30:00Z",45);
 const [merged]=mergeZhidaoEvidence([old],[newRecord]);
 assert.equal(merged.progress_percent,45);
});
