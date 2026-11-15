const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');
const words=n=>typeof n==='string'?n:(n.children??[]).map(words).join('');
const course={platform:'zhidao',course_id:'A',title:'Course A',course_type:'shared'};
const running={platform:'zhidao',state:'running',course_id:'A',run_id:'run-A',exit_code:null,zhs_stale:false,zhs_progress:{video_segment_percent:48.5}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(overrides={},bridge={}){
 const previous=global.window;let tick;
 global.window={setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}};
 const Panel=load('components/LegacyPlaybackPanel.tsx',{'bridge.ts':{friendlyBridgeError:String,...bridge},'legacyPlayback.ts':{
  getLegacyStatus:async()=>running,legacyError:String,legacyExitMessage:()=>'',originalYktDefaults:{},...overrides
 }}).LegacyPlaybackPanel;
 return {Panel,tick:()=>tick(),restore:()=>{if(previous===undefined)delete global.window;else global.window=previous;}};
}
const props={platform:'zhidao',courses:[course],desktop:true,connected:true,courseId:'A',detailMode:true};
test('ZHS sample and stop controls remain scoped when viewing another course',async()=>{
 const env=setup();let view;
 try{
  await act(async()=>{view=create(React.createElement(env.Panel,{...props,courseId:'B',courses:[course,{...course,course_id:'B',title:'Course B'}]}));});
  assert.doesNotMatch(words(view.root),/48.5%/);
  assert.match(words(view.root),/其他课程任务运行中/);
  assert.equal(view.root.findAllByType('button').find(n=>words(n)===' 停止').props.disabled,true);
 }finally{if(view)act(()=>view.unmount());env.restore();}
});
test('terminal ZHS verification runs once per run and records the actual course and run',async()=>{
 const calls=[],events=[],verified=[];
 const target={...course,progress_evidence:'server_verified',verified_at:'2026-11-14T18:00:00Z',progress_percent:40};
 const env=setup({getLegacyStatus:async()=>({...running,state:'exited',exit_code:0})},{request:async input=>{calls.push(input);return {courses:[target]};}});let view;
 try{
  await act(async()=>{view=create(React.createElement(env.Panel,{...props,onCourseVerified:c=>verified.push(c),onEvent:(...args)=>events.push(args)}));});
  await act(async()=>env.tick());
  assert.equal(calls.length,1);assert.equal(calls[0].course_key,'A');assert.deepEqual(verified,[target]);
  assert.deepEqual(events[0][3],{courseId:'A',runId:'run-A',runner:'zhs'});
 }finally{if(view)act(()=>view.unmount());env.restore();}
});
test('switching courses cancels a late terminal verification result and hides its status',async()=>{
 const result=deferred(),verified=[];let requests=0;
 const env=setup({getLegacyStatus:async()=>({...running,state:'exited',exit_code:0})},{request:async()=>{requests++;return result.promise;}});let view;
 try{
  const base={...props,courses:[course,{...course,course_id:'B',title:'Course B'}],onCourseVerified:c=>verified.push(c)};
  await act(async()=>{view=create(React.createElement(env.Panel,base));});
  assert.equal(requests,1);
  await act(async()=>view.update(React.createElement(env.Panel,{...base,courseId:'B'})));
  await act(async()=>result.resolve({courses:[{...course,progress_evidence:'server_verified',verified_at:'2026-11-14T18:00:00Z'}]}));
  assert.deepEqual(verified,[]);assert.equal(requests,1);
  assert.doesNotMatch(words(view.root),/已读取当前课程的服务器学习记录|正在只读核验/);
 }finally{if(view)act(()=>view.unmount());env.restore();}
});
test('expired ZHS telemetry shows waiting evidence without a percentage track',async()=>{
 const env=setup({getLegacyStatus:async()=>({...running,zhs_stale:true,zhs_progress:null})});let view;
 try{
  await act(async()=>{view=create(React.createElement(env.Panel,props));});
  assert.match(words(view.root),/本地进度输出已过期/);
  assert.equal(view.root.findAllByProps({role:'progressbar'}).length,0);
 }finally{if(view)act(()=>view.unmount());env.restore();}
});
test('a poll issued before starting cannot overwrite the new run, while the event retains run ownership',async()=>{
 const oldPoll=deferred(),launch=deferred();let reads=0;const events=[];
 const env=setup({getLegacyStatus:async()=>{reads++;return reads===1?{...running,state:'idle',run_id:null,zhs_progress:null}:reads===2?oldPoll.promise:running;},startLegacy:async()=>launch.promise});let view;
 try{
  await act(async()=>{view=create(React.createElement(env.Panel,{...props,onEvent:(...args)=>events.push(args)}));});
  act(()=>env.tick());
  act(()=>view.root.findAllByType('button').find(n=>words(n).includes('启动原版任务')).props.onClick());
  await act(async()=>{oldPoll.resolve({...running,state:'exited',run_id:'old-run',exit_code:0});});
  assert.doesNotMatch(words(view.root),/原版进程已退出/);
  await act(async()=>{launch.resolve(running);});
  assert.match(words(view.root),/原版进程运行中/);
  assert.equal(events[0][3].runId,'run-A');
  assert.equal(events[0][3].courseId,'A');
 }finally{if(view)act(()=>view.unmount());env.restore();}
});

test('failed terminal verification can retry without replaying or resending heartbeats',async()=>{
 const calls=[],verified=[];
 const target={...course,progress_evidence:'server_verified',verified_at:'2026-11-15T10:00:00Z',progress_percent:45};
 const env=setup({getLegacyStatus:async()=>({...running,state:'exited',exit_code:0})},{
  request:async input=>{calls.push(input);if(calls.length===1)throw new Error('temporarily offline');return {courses:[target]};}
 });let view;
 try{
  await act(async()=>{view=create(React.createElement(env.Panel,{...props,onCourseVerified:c=>verified.push(c)}));});
  assert.equal(calls.length,1);
  const retry=view.root.findAllByType('button').find(n=>words(n).includes('重试服务器核验'));
  assert.ok(retry,'an unknown server result must be explicitly retryable');
  await act(async()=>retry.props.onClick());
  assert.equal(calls.length,2);
  assert.deepEqual(verified,[target]);
  assert.ok(calls.every(input=>input.operation==='zhidao.progress.verify'&&input.course_key==='A'));
 }finally{if(view)act(()=>view.unmount());env.restore();}
});
