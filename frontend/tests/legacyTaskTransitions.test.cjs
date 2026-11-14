const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');
const words=n=>typeof n==='string'?n:(n.children??[]).map(words).join('');
const course={platform:'zhidao',course_id:'A',title:'Course A',course_type:'shared'};
const running={platform:'zhidao',state:'running',course_id:'A',run_id:'run-A',exit_code:null,zhs_stale:false,zhs_progress:{video_segment_percent:48.5}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(overrides={}){
 const previous=global.window;let tick;
 global.window={setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}};
 const Panel=load('components/LegacyPlaybackPanel.tsx',{'legacyPlayback.ts':{
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
