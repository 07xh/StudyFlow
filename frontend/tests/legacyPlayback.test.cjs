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
  assert.equal(d.debug, false);
  assert.equal(d.richtext_stay_seconds, 3);
  assert.equal(d.richtext_skip_delay, 1);
  assert.equal(legacy.validateOriginalOptions(d), true);
  assert.equal(legacy.validateOriginalOptions({...d, richtext_stay_seconds: 3601}), false);
  assert.equal(legacy.validateOriginalOptions({...d, richtext_skip_delay: Infinity}), false);
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
  await legacy.stopLegacy("zhidao","test-run-1");
  assert.deepEqual(calls.map(x=>x.operation), [
    "legacy_start", "legacy_start", "legacy_status", "legacy_stop"
  ]);
  assert.equal(calls[3].props.expectedRunId,"test-run-1");
  assert.equal(calls[0].props.courseId, zhsKey);
  assert.equal(calls[1].props.options.max_concurrent_videos, 3);
  assert.equal(calls[1].props.options.richtext_stay_seconds, 3);
  assert.equal(calls[1].props.options.richtext_skip_delay, 1);
  assert.equal(calls[1].props.options.debug, false);
  assert.equal(calls[1].props.courseId, null);
});

test("unknown host errors remain generic and do not leak credentials", () => {
  const legacy = loadWithStub(async () => {});
  assert.doesNotMatch(legacy.legacyError(new Error("Cookie SECRET=123")), /SECRET/);
});

test("desktop status keeps live ZHS telemetry distinct from verified course progress", async () => {
  const sample = {
    platform:"zhidao", state:"running", exit_code:null, course_id:"c".repeat(64),
    zhs_progress:{video_segment_percent:48.5, resource_index:2, resource_total:5}, zhs_stale:false
  };
  const calls = [];
  const legacy = loadWithStub(async (operation, props) => {
    calls.push({operation, props});
    return sample;
  });
  assert.deepEqual(await legacy.getLegacyStatus("zhidao"), sample);
  assert.deepEqual(calls, [{operation:"legacy_status", props:{platform:"zhidao"}}]);
});

test("the ZHS original segment is displayed only for the selected running course", () => {
  const panel = fs.readFileSync(path.join(__dirname,"..","src","components","LegacyPlaybackPanel.tsx"),"utf8");
  assert.match(panel, /status\?\.course_id === selection/);
  assert.match(panel, /status\?\.state === "running"/);
  assert.match(panel, /const zhsSegment=liveZhs\?\.resource_kind==="video"\?liveZhs.video_segment_percent:null/);
  assert.match(panel, /非服务器确认进度/);
  assert.match(panel, /结束前最后一次真实采样/);
  assert.match(panel, /未采集到播放进度/);
  assert.match(panel, /status\.zhs_stale/);
  assert.match(panel, /本地进度输出已过期/);
});


test("Rain Classroom advanced settings are exposed without expanding the default panel", () => {
  const panel = fs.readFileSync(path.join(__dirname,"..","src","components","YuketangTaskArea.tsx"),"utf8");
  assert.match(panel, /<details className="sf-ykt-advanced-options"(?: open=\{detailMode\})?>/);
  assert.doesNotMatch(panel, /open=\{detailMode\}/);
  assert.match(panel, /options\.richtext_stay_seconds/);
  assert.match(panel, /options\.richtext_skip_delay/);
  assert.match(panel, /options\.debug/);
  assert.match(panel, /RICHTEXT_STAY_SECONDS/);
});


test("ZHS exit diagnosis distinguishes session, route, runtime, interaction and successful exit", () => {
  const legacy = loadWithStub(async () => {});
  const status = code => ({
    platform:"zhidao", state:"exited", exit_code:code,
    course_id:"a".repeat(64), zhs_progress:null
  });
  assert.match(legacy.legacyExitMessage(status(4)), /登录会话或课程缓存/);
  assert.match(legacy.legacyExitMessage(status(5)), /ZHS 0\.1\.5 运行时/);
  assert.match(legacy.legacyExitMessage(status(6)), /课程路由/);
  assert.match(legacy.legacyExitMessage(status(9)), /交互输入/);
  assert.match(legacy.legacyExitMessage(status(0)), /不代表服务器确认/);
  assert.equal(legacy.legacyExitMessage({...status(1), state:"running"}), "");
});

test("original Zhidao task UI offers fresh AI and shared courses, not stale sessions", () => {
  const panel = fs.readFileSync(path.join(__dirname,"..","src","components","LegacyPlaybackPanel.tsx"),"utf8");
  assert.match(panel, /course_type === "ai" \|\| c\.course_type === "shared"/);
  assert.match(panel, /!c\.stale/);
  assert.match(panel, /legacyExitMessage\(status\)/);
});

test("task panel scopes its selected course and does not duplicate the header's verified totals", () => {
  const panel = fs.readFileSync(path.join(__dirname,"..","src","components","LegacyPlaybackPanel.tsx"),"utf8");
  assert.match(panel, /course\.platform==="zhidao"&&course\.course_id===selection/);
  assert.doesNotMatch(panel, /sf-live-course-progress/);
});

test("out-of-order task status polls cannot replace newer task state", () => {
  const panel = fs.readFileSync(path.join(__dirname,"..","src","components","LegacyPlaybackPanel.tsx"),"utf8");
  assert.match(panel, /latestStatusRequest = useRef\(0\)/);
  assert.match(panel, /requestId !== latestStatusRequest\.current/);
  assert.match(panel, /return \(\) => \{ window\.clearInterval\(timer\); latestStatusRequest\.current\+\+; \}/);
  assert.match(panel, /requestId === latestStatusRequest\.current && currentPlatform\.current === platform\) \{\s*setStatus\(next\);setStatusReadFailed\(false\)/);
});

test("ZHS status polling cannot race a start/stop action or carry across platforms", () => {
  const panel = fs.readFileSync(path.join(__dirname,"..","src","components","LegacyPlaybackPanel.tsx"),"utf8");
  assert.match(panel, /const taskActionInFlight = useRef\(false\)/);
  assert.match(panel, /if \(!desktop \|\| taskActionInFlight\.current\) return/);
  assert.match(panel, /requestId !== latestStatusRequest\.current \|\| taskActionInFlight\.current \|\| currentPlatform\.current !== platform/);
  assert.match(panel, /taskActionInFlight\.current = true/);
  assert.match(panel, /taskActionInFlight\.current = false/);
  assert.match(panel, /currentPlatform\.current === platform\) void updateStatus\(\)/);
});


test("original ZHS exit triggers exactly scoped read-only course reconciliation", () => {
  const panel = fs.readFileSync(path.join(__dirname,"..","src","components","LegacyPlaybackPanel.tsx"),"utf8");
  const app = fs.readFileSync(path.join(__dirname,"..","src","App.tsx"),"utf8");
  assert.match(panel, /status\.state !== "exited" && status\.state !== "stopped"/);
  assert.match(panel, /operation:"zhidao\.progress\.verify",course_key:status\.course_id/);
  assert.match(panel, /verifiedRunRef\.current === marker/);
  assert.match(panel, /target\?\.progress_evidence === "server_verified"/);
  assert.match(panel, /target\.verified_at/);
  assert.match(panel, /setVerificationState\("unknown"\)/);
  assert.match(panel, /onCourseVerifiedRef\.current\?\.\(target\)/);
  assert.match(panel, /if \(!active \|\| currentPlatform\.current !== "zhidao"\) return/);
  assert.match(app, /detailMode onCourseVerified=\{updateVerifiedZhidaoCourse\}/);
  assert.match(app, /onCourseVerified=\{updateVerifiedZhidaoCourse\}/);
  assert.match(app, /courses:previous\.zhidao\.courses\.map\(item=>/);
  // Reconcile is a read-only bridge operation, not a playback or heartbeat.
  assert.doesNotMatch(panel, /saveDatabaseIntervalTimeV2|studyRecord\/report|generateHeartbeat/);
});


test("ZHS options use documented CLI fields and the existing process bridge",async()=>{
  const calls=[];
  const legacy=loadWithStub(async (name,props)=>{calls.push({name,props});return {state:"running"};});
  const valid={...legacy.originalZhsDefaults,speed:1.25,limit_minutes:30,learn_optional:true,scope_mode:"all",selected_ids:[]};
  assert.equal(legacy.validateZhsOptions(valid),true);
  assert.equal(legacy.validateZhsOptions({...valid,speed:Infinity}),false);
  assert.equal(legacy.validateZhsOptions({...valid,limit_minutes:-1}),false);
  await assert.rejects(legacy.startLegacy("zhidao","a".repeat(64),undefined,{...valid,speed:3}),/INVALID_SETTINGS/);
  assert.equal(calls.length,0);
  await legacy.startLegacy("zhidao","a".repeat(64),undefined,valid);
  assert.deepEqual(calls[0].props.zhsOptions,valid);
  assert.equal(calls[0].props.options,null);
  const panel=fs.readFileSync(path.join(__dirname,"..","src","components","ZhsTaskSettingsPanel.tsx"),"utf8");
  assert.match(panel,/zhidao.zhs.settings.get/);
  assert.match(panel,/zhidao.zhs.settings.save/);
  assert.doesNotMatch(panel,/saveDatabaseIntervalTimeV2|generateHeartbeat/);
});



test("ZHS scoped task settings prohibit forged identifiers and unknown ranges",()=>{
  const legacy=loadWithStub(async()=>{});
  const valid={...legacy.originalZhsDefaults,scope_mode:"selected",selected_ids:[11,22]};
  assert.equal(legacy.validateZhsOptions(valid),true);
  assert.equal(legacy.validateZhsOptions({...valid,selected_ids:[11,11]}),false);
  assert.equal(legacy.validateZhsOptions({...valid,selected_ids:[-1]}),false);
  assert.equal(legacy.validateZhsOptions({...valid,scope_mode:"all"}),false);
  assert.equal(legacy.validateZhsOptions({...valid,max_videos:1001}),false);
  assert.equal(legacy.validateZhsOptions({...valid,speed_cap:3}),false);
});

test("status polling is single-flight and failed status reads remain visible", () => {
  const panel = fs.readFileSync(path.join(__dirname,"..","src","components","LegacyPlaybackPanel.tsx"),"utf8");
  assert.match(panel, /statusPollInFlight\.current === platform/);
  assert.match(panel, /statusPollInFlight\.current = platform/);
  assert.match(panel, /无法读取本地任务状态；显示的是上次记录/);
  assert.match(panel, /verificationRetry/);
  assert.match(panel, /重试服务器核验/);
});

test("IPC rejection is not misreported as a missing Python service",()=>{
  const bridge=fs.readFileSync(path.join(__dirname,"..","src","bridge.ts"),"utf8");
  const rust=fs.readFileSync(path.join(__dirname,"..","..","src-tauri","src","lib.rs"),"utf8");
  assert.match(bridge,/detail\.includes\("Operation not permitted"\)/);
  assert.match(bridge,/case "BRIDGE_COMMAND_REJECTED"/);
  assert.match(rust,/"zhidao\.zhs\.settings\.get"/);
  assert.match(rust,/"zhidao\.zhs\.settings\.save"/);
  assert.match(rust,/fn zhs_task_settings_ipc_accepts_global_or_valid_course_scopes/);
});

test("ZHS exit diagnostics show only allowlisted error categories", () => {
  const legacy=loadWithStub(async()=>{});
  const sample={platform:"zhidao",state:"exited",exit_code:1,diagnostic_code:"NETWORK_ERROR"};
  assert.match(legacy.zhsDiagnosticMessage(sample),/网络|连接错误/);
  assert.match(legacy.zhsDiagnosticMessage({...sample,diagnostic_code:"Cookie: SECRET=123"}),/未提供可确认的错误分类/);
  assert.doesNotMatch(legacy.zhsDiagnosticMessage({...sample,diagnostic_code:"Cookie: SECRET=123"}),/SECRET/);
  assert.equal(legacy.zhsDiagnosticMessage({...sample,exit_code:0}),"");
  assert.equal(legacy.zhsDiagnosticMessage({...sample,platform:"yuketang"}),"");
});

test("upstream ZHS CLI stage codes map to safe user-facing diagnostics",()=>{
  const legacy=loadWithStub(async()=>{});
  const sample={platform:"zhidao",state:"exited",exit_code:1};
  assert.match(legacy.zhsDiagnosticMessage({...sample,diagnostic_code:"ZHS_SESSION_PREFLIGHT_FAILED"}),/会话预检/);
  assert.match(legacy.zhsDiagnosticMessage({...sample,diagnostic_code:"ZHS_COURSE_URL_FAILED"}),/课程链接处理/);
});

test("ZHS cookie restore and server session errors have actionable, privacy-safe messages",()=>{
  const legacy=loadWithStub(async()=>{});
  const sample={platform:"zhidao",state:"exited",exit_code:1};
  assert.match(legacy.zhsDiagnosticMessage({...sample,diagnostic_code:"ZHS_COOKIE_RESTORE_FAILED"}),/凭证|Cookie/);
  assert.match(legacy.zhsDiagnosticMessage({...sample,diagnostic_code:"ZHS_SESSION_EXPIRED"}),/已过期|重新扫码/);
  assert.match(legacy.zhsDiagnosticMessage({...sample,diagnostic_code:"ZHS_SESSION_UNAVAILABLE"}),/暂时无法|网络/);
  assert.equal(legacy.zhsDiagnosticMessage({...sample,exit_code:0,diagnostic_code:"ZHS_SESSION_EXPIRED"}),"");
});

test("ZHS resource selection is local, type-checked and per course",()=>{
  const legacy=loadWithStub(async()=>{});
  const valid={...legacy.originalZhsDefaults,scope_mode:"all",selected_ids:[]};
  assert.equal(legacy.validateZhsOptions({...valid,resource_mode:"video"}),true);
  assert.equal(legacy.validateZhsOptions({...valid,resource_mode:"reading"}),true);
  assert.equal(legacy.validateZhsOptions({...valid,resource_mode:"videos"}),false);
  const settings=fs.readFileSync(path.join(__dirname,"..","src","components","ZhsTaskSettingsPanel.tsx"),"utf8");
  assert.match(settings,/本次选择的资源类型/);
  assert.match(settings,/只选择视频/);
  assert.match(settings,/文章 \/ PPT/);
  assert.match(settings,/resource_mode:resourceMode/);
  const panel=fs.readFileSync(path.join(__dirname,"..","src","components","LegacyPlaybackPanel.tsx"),"utf8");
  assert.match(panel,/resource_name/);
  assert.match(panel,/resource_kind/);
  assert.match(panel,/当前视频片段位置/);
  assert.doesNotMatch(panel,/当前本地模拟片段进度/);
});
