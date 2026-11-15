const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
function loadLegacy(stubInvoke,storage){
  const file=path.join(__dirname,"../src/legacyPlayback.ts");
  const output=ts.transpileModule(fs.readFileSync(file,"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
  }).outputText;
  const mod={exports:{}};
  global.window={localStorage:storage};
  new Function("module","exports","require",output)(mod,mod.exports,name=>{
    if(name==="./bridge")return {isDesktop:()=>true};
    if(name==="@tauri-apps/api/core")return {invoke:stubInvoke};
    return require(name);
  });
  return mod.exports;
}
test("Per-classroom threshold is isolated; runner honors explicit value and defaults to 100",async()=>{
  const calls=[],data=new Map();
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const legacy=loadLegacy(async(operation,props)=>{calls.push({operation,props});return {state:"running"};},storage);
  assert.equal(legacy.readYuketangCourseThreshold("12","45"),null);
  legacy.saveYuketangCourseThreshold("12","45",82);
  assert.equal(legacy.readYuketangCourseThreshold("12","45"),82);
  assert.equal(legacy.readYuketangCourseThreshold("13","45"),null);
  await legacy.startLegacy("yuketang",undefined,{...legacy.originalYktDefaults,completion_threshold:82});
  await legacy.startLegacy("yuketang");
  assert.equal(calls[0].props.options.completion_threshold,82);
  assert.equal(calls[1].props.options.completion_threshold,100);
  assert.equal(legacy.originalYktDefaults.completion_threshold,90);
  legacy.saveYuketangCourseThreshold("12","45",null);
  assert.equal(legacy.readYuketangCourseThreshold("12","45"),null);
  assert.throws(()=>legacy.saveYuketangCourseThreshold("12","45",101),/INVALID_SETTINGS/);
});
test("Native fallback respects per-classroom IPC; no fake completion shown",()=>{
  const rust=fs.readFileSync(path.join(__dirname,"../../src-tauri/src/legacy_tasks.rs"),"utf8");
  const block=rust.split('command.arg("--legacy-yuketang")')[1].split("command.stdin")[0];
  assert.match(block,/settings.apply\(&mut command\)/);
  assert.match(block,/if options.is_none\(\)/);
  assert.match(block,/command.env\("COMPLETION_THRESHOLD", "100"\)/);
  const panel=fs.readFileSync(path.join(__dirname,"../src/components/LegacyPlaybackPanel.tsx"),"utf8");
  assert.match(panel,/readYuketangCourseThreshold\(lastScope.classroom_id,lastScope.university_id\)/);
  assert.doesNotMatch(panel,/yuketang.settings.save/);
  assert.match(panel,/本轮处理结束 · 待平台核验/);
  assert.match(panel,/本轮跳过 · 待平台核验/);
  assert.match(panel,/单节是否完成以课程章节中的服务器只读核验为准/);
});
