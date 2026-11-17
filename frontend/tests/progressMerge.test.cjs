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

test("do not merge older account records into another authenticated session",()=>{
 const previous=make("2026-11-15T02:30:00Z",45);
 const otherLogin=make("2026-11-15T02:00:00Z",10,{session_marker:"b".repeat(64)});
 const noMarker=make("2026-11-15T02:00:00Z",10,{session_marker:null});
 assert.deepEqual(mergeZhidaoEvidence([previous],[otherLogin]),[otherLogin]);
 assert.deepEqual(mergeZhidaoEvidence([previous],[noMarker]),[noMarker]);
});

test("all asynchronous Zhidao course update entry points use one evidence-safe callback",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../src/App.tsx"),"utf8");
 assert.match(app,/const updateZhidaoCourses=useCallback\(\(incoming:Course\[\]\)=>/);
 assert.match(app,/courses:mergeZhidaoEvidence\(previous\.zhidao\.courses,incoming\)/);
 assert.equal(app.split("onCoursesUpdated={updateZhidaoCourses}").length-1,2,
   "settings verification and player-close monitoring must use the shared merge path");
 assert.match(app,/if\(course\.platform==="zhidao"\)\{updateZhidaoCourses\(list\);return;\}/,
   "course workspace must use the same update path");
 assert.doesNotMatch(app,/onCoursesUpdated=\{list=>setPlatforms\(previous=>\(\{\.\.\.previous,zhidao:/,
   "the close monitor must not replace the whole platform course list directly");
});

test("automatic verification and course sync share the evidence merge path",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../src/App.tsx"),"utf8");
 const helperAt=app.indexOf("const updateZhidaoCourses=useCallback(");
 const autoAt=app.indexOf("const autoVerifyError=useZhidaoAutoVerify(");
 assert.ok(helperAt>0&&autoAt>helperAt,"shared callback must be initialized before automatic verification");
 assert.match(app,/onSnapshot:snapshot=>updateZhidaoCourses\(snapshot\.courses\)/);
 assert.match(app,/if\(platform==="zhidao"\)\{\s*updateZhidaoCourses\(list\);\s*\}else\{/);
 assert.match(app,/\[desktop,consentAccepted,recordEvent,updateZhidaoCourses\]/);
 assert.equal((app.match(/courses:mergeZhidaoEvidence\(previous\.zhidao\.courses,incoming\)/g)||[]).length,1,
   "the list merge should be implemented once in the common callback");
});
