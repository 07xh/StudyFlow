const test=require("node:test"),assert=require("node:assert/strict");
const React=require("react"),{create,act}=require("react-test-renderer");
const fs=require("node:fs"),path=require("node:path");
const load=require("./helpers/load.cjs");
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test("global task polling does not enqueue duplicate requests while a read is in flight",async()=>{
 const oldWindow=global.window;let interval,queries=0;const first=defer();
 global.window={setInterval:fn=>{interval=fn;return 1;},clearInterval:()=>{}};
 const {useRuntimeTasks}=load("runtimeTasks.ts",{
  "@tauri-apps/api/core":{invoke:async()=>{queries++;return queries===1?first.promise:{state:"idle",courseKey:null,runId:null,exitCode:null};}},
  "legacyPlayback.ts":{getLegacyStatus:async(platform)=>({platform,state:"idle",course_id:null,run_id:null,exit_code:null}),stopLegacy:async()=>{}},
  "taskRecovery.ts":{readTaskRecovery:()=>[],discardTaskRecovery:()=>{}}
 });
 function Viewer(){const {tasks}=useRuntimeTasks(true);return React.createElement("div",null,String(tasks.length));}
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Viewer));});
  assert.equal(queries,1);
  await act(async()=>{interval();interval();interval();});
  assert.equal(queries,1,"periodic polls must not enqueue while request is pending");
  await act(async()=>{first.resolve({state:"idle",courseKey:null,runId:null,exitCode:null});});
  await act(async()=>{interval();});
  assert.equal(queries,2,"new poll should resume once the first finishes");
 }finally{
  if(view)act(()=>view.unmount());
  if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
 }
});

test("official player status and start-stop actions have independent in-flight guards",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../src/components/ZhidaoOfficialPlayerPanel.tsx"),"utf8");
 assert.match(source,/statusInFlight\.current\|\|actionInFlight\.current/);
 assert.match(source,/statusInFlight\.current=true/);
 assert.match(source,/statusInFlight\.current=false/);
 assert.match(source,/if\(!selected\|\|actionInFlight\.current\)return/);
 assert.match(source,/if\(!ownsStatus\|\|!active\|\|!status\.runId\|\|actionInFlight\.current\)return/);
 assert.match(source,/statusRevision\.current\+\+/);
 assert.match(source,/finally\{actionInFlight\.current=false;setBusy\(null\);void refreshStatus\(\);\}/);
});
