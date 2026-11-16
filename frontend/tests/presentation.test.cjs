const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTypescript(relativePath) {
  const file = path.join(__dirname, "..", relativePath);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
  }).outputText;
  const mod = {exports: {}};
  const localRequire = name => name === "@tauri-apps/api/core"
    ? {invoke: async () => {throw new Error("Tauri is not invoked in these pure tests");}}
    : require(name);
  new Function("module", "exports", "require", code)(mod, mod.exports, localRequire);
  return mod.exports;
}

const {presentCourse} = loadTypescript("src/presentation.ts");
test("course workspace drops removed session data and follows refreshed records", () => {
  const {selectedSessionCourse} = loadTypescript("src/presentation.ts");
  const selected = {platform:"zhidao", course_id:"a", title:"old"};
  assert.equal(selectedSessionCourse([], selected), null);
  assert.equal(selectedSessionCourse([{...selected, platform:"yuketang"}], selected), null);
  const refreshed = {...selected, title:"new"};
  assert.equal(selectedSessionCourse([refreshed], selected), refreshed);
});
const {fetchPlatformStatuses, fetchCourses, friendlyBridgeError} = loadTypescript("src/bridge.ts");
const base = {platform: "zhidao", course_id: "id-1", title: "测试课程", progress_percent: 75};

test("no unverified course percentage, even if value looks plausible", () => {
  const state = presentCourse({...base, progress_evidence: null});
  assert.equal(state.percent, null);
  assert.equal(state.status, "unverified");
});

test("stale verified data never displays as current", () => {
  const state = presentCourse({...base, progress_evidence: "server_verified", verified_at: "2026-11-01", stale: true});
  assert.equal(state.status, "cached");
  assert.equal(state.percent, null);
});

test("verified progress requires evidence and verification timestamp", () => {
  assert.equal(presentCourse({...base, progress_evidence: "server_verified"}).percent, null);
  const state = presentCourse({...base, progress_evidence: "server_verified", verified_at: "2026-11-14"});
  assert.equal(state.percent, 75);
  assert.equal(state.status, "verified");
  assert.equal(presentCourse({...base, progress_percent: 0, progress_evidence: "server_verified", verified_at: "2026-11-14"}).percent, 0);
});

test("bridge validates actual platform status and does not synthesize courses", async () => {
  const transport = {request: async req => ({
    id: req.id, ok: true, data: [
      {platform: "zhidao", connected: true, message: "服务器已确认"},
      {platform: "yuketang", connected: false, message: "未接入"},
      {platform: "xuexitong", connected: false, message: "未导入会话"},
      {platform: "ucampus", connected: false, message: "尚未核验真实课程接口"}
    ]
  })};
  const status = await fetchPlatformStatuses(transport);
  assert.equal(status[0].status, "connected");
  assert.equal(status[0].courses.length, 0);
  assert.equal(status[1].status, "not_connected");
  assert.equal(status[2].platform, "xuexitong");
  assert.equal(status[2].status, "not_connected");
  assert.equal(status[3].platform, "ucampus");
  assert.equal(status[3].status, "not_connected");
});

test("course bridge preserves exact source fields but rejects progress without provenance", async () => {
  const transport = {request: async req => ({
    id: req.id, ok: true, data: [{
      platform: "zhidao", course_id: "hash-1", title: "来自接口的课程",
      progress_percent: 65, progress_evidence: null, stale: true,
      unused_payload: "do not copy"
    }]
  })};
  const courses = await fetchCourses(transport, "zhidao");
  assert.equal(courses.length, 1);
  assert.equal(courses[0].title, "来自接口的课程");
  assert.equal(courses[0].unused_payload, undefined);
  assert.equal(presentCourse(courses[0]).percent, null);
});

test("IPC responses with mismatched identifiers or platform are rejected", async () => {
  const changedId = {request: async req => ({id: "wrong-id", ok: true, data: []})};
  await assert.rejects(fetchCourses(changedId, "zhidao"), /INVALID_IPC_RESPONSE/);
  const changedPlatform = {request: async req => ({
    id: req.id, ok: true, data: [{platform: "yuketang", course_id: "1", title: "不匹配", progress_percent: null}]
  })};
  await assert.rejects(fetchCourses(changedPlatform, "zhidao"), /INVALID_IPC_RESPONSE/);
});

test("unknown backend errors render only a generic local message", async () => {
  const bad = {request: async req => ({id: req.id, ok: false, error: "Cookie=SECRET_TOKEN"})};
  await assert.rejects(fetchCourses(bad, "zhidao"), /PLATFORM_NOT_READY/);
  assert.doesNotMatch(friendlyBridgeError(new Error("Cookie=SECRET_TOKEN")), /SECRET_TOKEN/);
});


test("updater explains fixed backend codes without leaking raw errors", () => {
  const {friendlyUpdateError} = loadTypescript("src/bridge.ts");
  assert.match(friendlyUpdateError(new Error("UPDATE_NETWORK_FAILED")), /GitHub/);
  assert.match(friendlyUpdateError(new Error("UPDATE_CHECKSUM_FAILED")), /SHA-256/);
  assert.match(friendlyUpdateError(new Error("UPDATE_STORAGE_FAILED")), /磁盘/);
  assert.doesNotMatch(friendlyUpdateError(new Error("Cookie=SECRET_TOKEN")), /SECRET_TOKEN/);
});

test("Rain Classroom video completion comes only from complete server-verified scans", () => {
  const {courseMetric,platformProgressOverview}=loadTypescript("src/presentation.ts");
  const course={platform:"yuketang",course_id:"room-1",title:"真实课堂",progress_percent:null};
  const partial={total:10,verified:8,completed:5,complete:true,scanning:false,checkedAt:1000};
  const awaiting=courseMetric(course,partial);
  assert.equal(awaiting.percent,null,"unknown videos must not become zero or completed");
  assert.match(awaiting.detail,/已核验 8\/10/);
  assert.equal(platformProgressOverview([course],{"room-1":partial}).percent,null);

  const complete={...partial,verified:10,completed:6};
  assert.equal(courseMetric(course,complete).percent,60);
  assert.match(courseMetric(course,complete).label,/视频/);
  assert.equal(platformProgressOverview([course],{"room-1":complete}).percent,60);
  assert.equal(presentCourse({...course,stale:true},complete).percent,null);
  assert.equal(courseMetric(course,{...complete,total:0,verified:0,completed:0}).percent,null);
});

test("platform overview weights verified Rain Classroom videos and does not claim official overall progress",()=>{
  const {platformProgressOverview}=loadTypescript("src/presentation.ts");
  const courses=[
    {platform:"yuketang",course_id:"one",title:"一",progress_percent:null},
    {platform:"yuketang",course_id:"two",title:"二",progress_percent:null}
  ];
  const first={total:2,verified:2,completed:1,complete:true,scanning:false,checkedAt:1000};
  const second={total:8,verified:8,completed:6,complete:true,scanning:false,checkedAt:2000};
  const full=platformProgressOverview(courses,{one:first,two:second});
  assert.equal(full.percent,70,"7 confirmed completed videos out of 10, not the mean of course percentages");
  assert.equal(full.verifiedCount,2);
  assert.match(full.detail,/非官方总进度/);
  const incomplete=platformProgressOverview(courses,{one:first,two:{...second,verified:7}});
  assert.equal(incomplete.percent,null);
  assert.equal(incomplete.verifiedCount,1);
  assert.match(incomplete.detail,/总体进度待核验/);
  assert.equal(platformProgressOverview([]).percent,null);
});

test("verified Zhidao courses retain labeled evidence and show a reference mean only when complete",()=>{
  const {platformProgressOverview}=loadTypescript("src/presentation.ts");
  const base={platform:"zhidao",progress_evidence:"server_verified",verified_at:"2026-11-15"};
  const courses=[
    {...base,course_id:"a",title:"A",course_type:"shared",progress_percent:30},
    {...base,course_id:"b",title:"B",course_type:"ai",progress_percent:70}
  ];
  assert.equal(platformProgressOverview(courses).percent,50);
  assert.equal(platformProgressOverview([{...courses[0],verified_at:null},courses[1]]).percent,null);
});
