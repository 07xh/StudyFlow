const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');

function deferred(){
 let resolve;
 const promise=new Promise(r=>{resolve=r;});
 return {promise,resolve};
}

test('a hanging official-player request cannot freeze ZHS or YKT status polling',async()=>{
 const oldWindow=global.window;
 let interval;
 const official=deferred();
 let officialReads=0,zhsReads=0,yktReads=0;
 global.window={setInterval:fn=>{interval=fn;return 1;},clearInterval:()=>{}};
 const {useRuntimeTasks}=load('runtimeTasks.ts',{
  '@tauri-apps/api/core':{
   invoke:async()=>{officialReads++;return officialReads===1?official.promise:
     {state:'idle',courseKey:null,runId:null,exitCode:null};}
  },
  'legacyPlayback.ts':{
   getLegacyStatus:async platform=>{
    if(platform==='zhidao'){
     zhsReads++;
     return {state:'running',course_id:'course-zhs',
       run_id:'zhs-'+zhsReads,exit_code:null};
    }
    yktReads++;
    return {state:'running',course_id:'class-ykt',
      run_id:'ykt-'+yktReads,exit_code:null};
   },
   stopLegacy:async()=>{}
  },
  'taskRecovery.ts':{readTaskRecovery:()=>[],discardTaskRecovery:()=>{}}
 });
 let current;
 function Viewer(){
  current=useRuntimeTasks(true);
  return React.createElement('div',null,String(current.tasks.length));
 }
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Viewer));});
  assert.equal(officialReads,1);
  assert.equal(zhsReads,1);
  assert.equal(yktReads,1);
  assert.equal(current.loading,false,'successful providers must render without waiting for hung IPC');
  assert.equal(current.tasks.find(t=>t.runner==='zhs').runId,'zhs-1');
  assert.equal(current.tasks.find(t=>t.runner==='yuketang').runId,'ykt-1');

  await act(async()=>{interval();interval();});
  assert.equal(officialReads,1,'never overlap requests for the same blocked provider');
  assert.equal(zhsReads,3,'other providers still refresh independently');
  assert.equal(yktReads,3);
  assert.equal(current.tasks.find(t=>t.runner==='zhs').runId,'zhs-3');

  await act(async()=>{official.resolve({state:'idle',courseKey:null,runId:null,exitCode:null});});
  await act(async()=>{interval();});
  assert.equal(officialReads,2,'a previously blocked provider resumes on completion');
 }finally{
  if(view)await act(async()=>{view.unmount();});
  if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
 }
});

test('one failed provider does not overwrite other running identities',async()=>{
 const oldWindow=global.window;
 global.window={setInterval:()=>1,clearInterval:()=>{}};
 let failed=false;
 const {useRuntimeTasks}=load('runtimeTasks.ts',{
  '@tauri-apps/api/core':{invoke:async()=>({state:'running',courseKey:'own-course',runId:'official-run',exitCode:null})},
  'legacyPlayback.ts':{
   getLegacyStatus:async platform=>{
    if(platform==='zhidao'){if(failed)throw Error('offline');return {state:'running',course_id:'z-course',run_id:'z-run',exit_code:null};}
    return {state:'running',course_id:'y-course',run_id:'y-run',exit_code:null};
   },
   stopLegacy:async()=>{}
  },
  'taskRecovery.ts':{readTaskRecovery:()=>[],discardTaskRecovery:()=>{}}
 });
 let current;
 function Viewer(){current=useRuntimeTasks(true);return React.createElement('p',null,current.tasks.length);}
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Viewer));});
  assert.equal(current.tasks.length,3);
  failed=true;
  await act(async()=>{await current.refresh();});
  const z=current.tasks.find(t=>t.runner==='zhs');
  assert.equal(z.unavailable,true);
  assert.equal(z.runId,'z-run','retain identity for diagnostics, but mark it unavailable');
  assert.equal(current.tasks.find(t=>t.runner==='official').unavailable,undefined);
  assert.equal(current.tasks.find(t=>t.runner==='yuketang').runId,'y-run');
 }finally{
  if(view)await act(async()=>{view.unmount();});
  if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
 }
});
