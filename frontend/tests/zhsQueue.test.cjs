const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');
const words=n=>typeof n==='string'?n:(n.children??[]).map(words).join('');
const status={platform:'zhidao',state:'running',run_id:'run-1',course_id:'a'.repeat(64),zhs_progress:null,
 zhs_stale:false,exit_code:null,zhs_queue:{concurrency:2,state:'running',stale:false,tasks:[
  {task_id:'b'.repeat(32),name:'电路基础',chapter_key:'ai-1',chapter_name:'第一章',kind:'video',state:'running',percent:25,stale:false,exit_code:null},
  {task_id:'c'.repeat(32),name:'交流电路',chapter_key:'ai-2',chapter_name:'第二章',kind:'video',state:'running',percent:63,stale:false,exit_code:null},
  {task_id:'d'.repeat(32),name:'第三讲',chapter_key:'ai-1',chapter_name:'第一章',kind:'video',state:'queued',percent:null,stale:false,exit_code:null}
 ]}};
test('concurrency bounds stop invalid options before IPC and per-video stop carries identity',async()=>{
 const calls=[];
 const api=load('legacyPlayback.ts',{'bridge.ts':{isDesktop:()=>true},'@tauri-apps/api/core':{invoke:async(...args)=>calls.push(args)}});
 assert.equal(api.originalZhsDefaults.concurrency,2);
 for(const concurrency of [0,4,1.5,true])assert.equal(api.validateZhsStoredOptions({...api.originalZhsDefaults,concurrency}),false);
 await assert.rejects(api.stopZhsVideo('', 'b'.repeat(32)),/TASK_RUN_CHANGED/);
 await api.stopZhsVideo('run-1','b'.repeat(32));
 assert.deepEqual(calls,[['zhs_queue_stop_video',{expectedRunId:'run-1',taskId:'b'.repeat(32)}]]);
});
test('independent progress bars and stop buttons belong to exact video and run',async()=>{
 const calls=[];
 const Panel=load('components/ZhsQueuePanel.tsx',{'legacyPlayback.ts':{
  stopZhsVideo:async(...args)=>calls.push(args),legacyError:String,legacyExitMessage:()=>''
 }}).ZhsQueuePanel;
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{status,onRefresh:async()=>{}}));});
  const bars=view.root.findAllByProps({role:'progressbar'});
  assert.deepEqual(bars.map(x=>x.props['aria-valuenow']),[25,63]);
  assert.match(words(view.root),/电路基础/);assert.match(words(view.root),/交流电路/);
  assert.match(words(view.root),/章节并行 · 2 路/);
  assert.equal(view.root.findAllByProps({'aria-label':'第一章'}).length,2);
  assert.equal(view.root.findAllByProps({'aria-label':'第二章'}).length,1);
  const stop=view.root.findAllByType('button').find(x=>x.props['aria-label']==='停止电路基础');
  await act(async()=>stop.props.onClick());
  assert.deepEqual(calls,[['run-1','b'.repeat(32)]]);
  assert.equal(view.root.findAllByType('button').find(x=>x.props['aria-label']==='停止电路基础').props.disabled,true);
 }finally{if(view)act(()=>view.unmount());}
});
test('stale or failed polling hides all percentages and disables row controls',async()=>{
 const Panel=load('components/ZhsQueuePanel.tsx',{'legacyPlayback.ts':{
  stopZhsVideo:async()=>{},legacyError:String,legacyExitMessage:()=>''
 }}).ZhsQueuePanel;
 for(const props of [{status:{...status,zhs_queue:{...status.zhs_queue,stale:true}}},{status,unavailable:true}]){
  let view;
  try{
   await act(async()=>{view=create(React.createElement(Panel,{...props,onRefresh:async()=>{}}));});
   assert.equal(view.root.findAllByProps({role:'progressbar'}).length,0);
   assert.doesNotMatch(words(view.root),/25%|63%/);
   assert.ok(view.root.findAllByType('button').every(b=>b.props.disabled));
  }finally{if(view)act(()=>view.unmount());}
 }
});
