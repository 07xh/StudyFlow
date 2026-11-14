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
  new Function("module", "exports", "require", code)(mod, mod.exports, require);
  return mod.exports;
}

const {presentCourse} = loadTypescript("src/presentation.ts");
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
      {platform: "yuketang", connected: false, message: "未接入"}
    ]
  })};
  const status = await fetchPlatformStatuses(transport);
  assert.equal(status[0].status, "connected");
  assert.equal(status[0].courses.length, 0);
  assert.equal(status[1].status, "not_connected");
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
