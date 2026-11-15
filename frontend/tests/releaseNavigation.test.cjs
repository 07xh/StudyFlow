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


test("GitHub latest button resolves and opens validated release tag",async()=>{
  let calls=[],prevented=false,errors=[];
  const service=load("releaseNavigation.ts",{
    "./bridge":{
      isDesktop:()=>true,
      request:async query=>{calls.push(query);return {version:"v0.1.1-rc.25"};}
    },
    "@tauri-apps/api/core":{invoke:async (...args)=>calls.push(args)}
  });
  await service.openLatestRelease({preventDefault:()=>{prevented=true;}},value=>errors.push(value));
  assert.equal(prevented,true);
  assert.deepEqual(calls,[{operation:"updates.latest"},["studyflow_open_releases",{tag:"v0.1.1-rc.25"}]]);
  assert.deepEqual(errors,[]);
});

test("GitHub latest button never opens an unverified or unsafe tag",async()=>{
  for(const tag of [null,"../bad","https://other.example","v1.0.0/redirect"]){
    let opened=false,message="";
    const service=load("releaseNavigation.ts",{
      "./bridge":{isDesktop:()=>true,request:async()=>({version:tag})},
      "@tauri-apps/api/core":{invoke:async()=>{opened=true;}}
    });
    await service.openLatestRelease({preventDefault(){}},error=>{message=error;});
    assert.equal(opened,false);
    assert.match(message,/未找到已发布/);
  }
});

test("GitHub latest lookup failure shows actionable error instead of opening stale list",async()=>{
  let calls=0,error="";
  const service=load("releaseNavigation.ts",{
    "./bridge":{isDesktop:()=>true,request:async()=>{throw Error("API unavailable");}},
    "@tauri-apps/api/core":{invoke:async()=>{calls++;}}
  });
  await service.openLatestRelease({preventDefault(){}},message=>{error=message;});
  assert.equal(calls,0);
  assert.match(error,/无法核验/);
  assert.doesNotMatch(error,/API unavailable/);
});
