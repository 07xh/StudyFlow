const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadWithStub(stubInvoke) {
  const file = path.join(__dirname, "..", "src", "legacyPlayback.ts");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
  }).outputText;
  const mod = {exports: {}};
  const localRequire = name => {
    if (name === "./bridge") return {isDesktop: () => true};
    if (name === "@tauri-apps/api/core") return {invoke: stubInvoke};
    return require(name);
  };
  new Function("module", "exports", "require", output)(mod, mod.exports, localRequire);
  return mod.exports;
}

test("YKT legacy options preserve original main.py defaults", () => {
  const legacy = loadWithStub(async () => {throw Error("do not invoke");});
  const d = legacy.originalYktDefaults;
  assert.equal(d.video_speed, 1.5);
  assert.equal(d.heartbeat_interval, 5);
  assert.equal(d.max_concurrent_videos, 3);
  assert.equal(d.completion_threshold, 90);
  assert.equal(d.test_mode, false);
  assert.equal(legacy.validateOriginalOptions(d), true);
});

test("invalid legacy options are rejected before any original process starts", async () => {
  const calls = [];
  const legacy = loadWithStub(async (...args) => {calls.push(args); return {};});
  assert.equal(legacy.validateOriginalOptions({...legacy.originalYktDefaults, max_concurrent_videos: 100}), false);
  await assert.rejects(legacy.startLegacy("yuketang", undefined, {
    ...legacy.originalYktDefaults, video_speed: Infinity
  }), /INVALID_SETTINGS/);
  await assert.rejects(legacy.startLegacy("zhidao", "not-an-identity"), /INVALID_COURSE/);
  assert.equal(calls.length, 0);
});

test("real desktop bridge invokes original platform task, never reimplements network heartbeat", async () => {
  const calls = [];
  const legacy = loadWithStub(async (operation, props) => {
    calls.push({operation, props});
    return {platform:props.platform, state:"running", exit_code:null};
  });
  const zhsKey = "a".repeat(64);
  await legacy.startLegacy("zhidao", zhsKey);
  await legacy.startLegacy("yuketang", undefined, legacy.originalYktDefaults);
  await legacy.getLegacyStatus("yuketang");
  await legacy.stopLegacy("zhidao");
  assert.deepEqual(calls.map(x=>x.operation), [
    "legacy_start", "legacy_start", "legacy_status", "legacy_stop"
  ]);
  assert.equal(calls[0].props.courseId, zhsKey);
  assert.equal(calls[1].props.options.max_concurrent_videos, 3);
  assert.equal(calls[1].props.courseId, null);
});

test("unknown host errors remain generic and do not leak credentials", () => {
  const legacy = loadWithStub(async () => {});
  assert.doesNotMatch(legacy.legacyError(new Error("Cookie SECRET=123")), /SECRET/);
});
