const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const fs=require("node:fs");
const path=require("node:path");
const load=require("./helpers/load.cjs");

test("unchanged nested status replies are equal without discarding genuine progress or stale-state changes",()=>{
  const {sameStatusSnapshot}=load("statusSnapshot.ts");
  const first={state:"running",run_id:"r1",zhs_queue:{
    tasks:[{task_id:"1",state:"running",percent:15},{task_id:"2",state:"queued",percent:null}]
  }};
  assert.ok(sameStatusSnapshot(first,JSON.parse(JSON.stringify(first))));
  assert.equal(sameStatusSnapshot(first,{...first,zhs_queue:{tasks:[
    {...first.zhs_queue.tasks[0],percent:16},first.zhs_queue.tasks[1]
  ]}}),false);
  assert.equal(sameStatusSnapshot(first,{...first,state:"stopped"}),false);
  assert.equal(sameStatusSnapshot(first,{...first,zhs_queue:{tasks:[]}}),false);
  assert.ok(sameStatusSnapshot({state:"running",updated_at:"old"},
    {state:"running",updated_at:"new"},new Set(["updated_at"])));
  assert.equal(sameStatusSnapshot({state:"running",updated_at:"old"},
    {state:"error",updated_at:"new"},new Set(["updated_at"])),false);
});

test("identical global runner polls do not rerender App subscribers; state changes still do",async()=>{
  const oldWindow=global.window;
  let interval;
  let state="idle";
  global.window={setInterval:fn=>{interval=fn;return 1;},clearInterval:()=>{}};
  const {useRuntimeTasks}=load("runtimeTasks.ts",{
    "@tauri-apps/api/core":{invoke:async()=>({
      state,courseKey:null,runId:null,exitCode:null
    })},
    "legacyPlayback.ts":{
      getLegacyStatus:async()=>({
        state:"idle",course_id:null,run_id:null,exit_code:null
      }),stopLegacy:async()=>{}
    },
    "taskRecovery.ts":{readTaskRecovery:()=>[],discardTaskRecovery:()=>{}}
  });
  let renders=0;
  let current;
  function Viewer(){
    renders++;
    current=useRuntimeTasks(true);
    return React.createElement("div",null,String(current.tasks.length));
  }
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Viewer));});
    assert.equal(current.tasks.length,3);
    const before=renders;
    await act(async()=>{interval();await Promise.resolve();});
    assert.equal(renders,before,"no App render when none of the three runners changed");
    state="running";
    await act(async()=>{interval();await Promise.resolve();});
    assert.ok(renders>before,"changed official runner must propagate");
    assert.equal(current.tasks.find(x=>x.runner==="official").state,"running");
  }finally{
    if(view)await act(async()=>view.unmount());
    if(oldWindow===undefined)delete global.window;
    else global.window=oldWindow;
  }
});

test("large opaque shell surfaces do not spend compositor time on blur for every frame",()=>{
  const css=fs.readFileSync(path.join(__dirname,"../src/ui/foundation.css"),"utf8");
  for(const selector of [".sf-shell .main{",".sf-shell .sf-floating-nav{",".sf-shell .sf-workspace-header{"]){
    const i=css.indexOf(selector);
    assert.ok(i>=0,selector+" should exist");
    const block=css.slice(i,css.indexOf("}",i));
    assert.doesNotMatch(block,/backdrop-filter\s*:/,selector+" should use opaque gradient");
  }
  assert.match(css,/@keyframes sf-zhs-progress-wait\{from\{transform:translateX\(0\)\}/,
    "indeterminate status animation should be compositor-driven, not left/width layout");
});
