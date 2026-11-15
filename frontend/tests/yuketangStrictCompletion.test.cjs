const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");

function loadLegacy(stubInvoke){
  const file=path.join(__dirname,"../src/legacyPlayback.ts");
  const output=ts.transpileModule(fs.readFileSync(file,"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
  }).outputText;
  const mod={exports:{}};
  new Function("module","exports","require",output)(mod,mod.exports,name=>{
    if(name==="./bridge")return {isDesktop:()=>true};
    if(name==="@tauri-apps/api/core")return {invoke:stubInvoke};
    return require(name);
  });
  return mod.exports;
}

test("saved upstream 90% threshold must not prematurely end the next Rain Classroom video",async()=>{
  const calls=[];
  const legacy=loadLegacy(async(operation,props)=>{
    calls.push({operation,props});
    return {platform:"yuketang",state:"running",exit_code:null};
  });
  await legacy.startLegacy("yuketang",undefined,{...legacy.originalYktDefaults,completion_threshold:90});
  await legacy.startLegacy("yuketang");
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.operation==="legacy_start"));
  assert.ok(calls.every(call=>call.props.options.completion_threshold===100));
  assert.equal(legacy.originalYktDefaults.completion_threshold,90,
    "The preserved original defaults must not be rewritten");
});

test("native runner enforces 100% even when old settings or omitted IPC options bypass the UI",()=>{
  const rust=fs.readFileSync(path.join(__dirname,"../../src-tauri/src/legacy_tasks.rs"),"utf8");
  const yuketangBranch=rust.split('command.arg("--legacy-yuketang")')[1].split("command.stdin")[0];
  assert.match(yuketangBranch,/command\.env\("COMPLETION_THRESHOLD", "100"\)/);
  assert.ok(yuketangBranch.indexOf('settings.apply(&mut command)') <
            yuketangBranch.indexOf('command.env("COMPLETION_THRESHOLD", "100")'),
    "Strict guard must overwrite legacy settings even when a persisted value is 90");
});

test("worker finished/skipped never means server-confirmed completion in course UI",()=>{
  const panel=fs.readFileSync(path.join(__dirname,"../src/components/LegacyPlaybackPanel.tsx"),"utf8");
  const settings=fs.readFileSync(path.join(__dirname,"../src/components/YuketangTaskArea.tsx"),"utf8");
  assert.match(panel,/本轮处理结束 · 待平台核验/);
  assert.match(panel,/本轮跳过 · 待平台核验/);
  assert.match(panel,/单节是否完成以课程章节中的服务器只读核验为准/);
  assert.match(settings,/completion_threshold:100/);
  assert.match(settings,/执行完成阈值（固定100%）/);
});
