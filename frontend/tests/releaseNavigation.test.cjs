const test=require("node:test");
const assert=require("node:assert/strict");
const load=require("./helpers/load.cjs");

test("ordinary browser releases link keeps native link behavior",async()=>{
  let called=0,prevented=false;
  const service=load("releaseNavigation.ts",{
    "./bridge":{isDesktop:()=>false},
    "@tauri-apps/api/core":{invoke:async()=>{called++;}}
  });
  await service.openOfficialReleases({preventDefault:()=>{prevented=true;}},()=>{throw Error("unexpected");});
  assert.equal(called,0);
  assert.equal(prevented,false);
});

test("Tauri releases link opens trusted native browser command",async()=>{
  let command="",prevented=false;
  const service=load("releaseNavigation.ts",{
    "./bridge":{isDesktop:()=>true},
    "@tauri-apps/api/core":{invoke:async value=>{command=value;}}
  });
  await service.openOfficialReleases({preventDefault:()=>{prevented=true;}},()=>{throw Error("unexpected");});
  assert.equal(prevented,true);
  assert.equal(command,"studyflow_open_releases");
});

test("Tauri browser failures produce a safe official link instead of leaking exceptions",async()=>{
  let error="";
  const service=load("releaseNavigation.ts",{
    "./bridge":{isDesktop:()=>true},
    "@tauri-apps/api/core":{invoke:async()=>{throw Error("private native path");}}
  });
  await service.openOfficialReleases({preventDefault(){}},value=>{error=value;});
  assert.match(error,/https:\/\/github\.com\/07xh\/StudyFlow\/releases/);
  assert.doesNotMatch(error,/private native path/);
});
