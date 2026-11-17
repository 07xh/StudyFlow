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
   const placeholders=view.root.findAllByProps({role:'progressbar'});
   assert.equal(placeholders.length,2,'running tasks retain nonnumeric placeholders');
   assert.ok(placeholders.every(p=>p.props['aria-valuenow']===undefined));
   assert.ok(placeholders.every(p=>/is-unverified/.test(p.props.className)));
   assert.ok(placeholders.every(p=>p.findAllByType('span').every(x=>x.props.style?.width==='0%')),
     'unverified tracks never draw a misleading numeric fill');
   assert.doesNotMatch(words(view.root),/25%|63%/);
   assert.ok(view.root.findAllByType('button').every(b=>b.props.disabled));
  }finally{if(view)act(()=>view.unmount());}
 }
});

test('reading resources show execution state without a fake video sampling failure',async()=>{
 const Panel=load('components/ZhsQueuePanel.tsx',{'legacyPlayback.ts':{
  stopZhsVideo:async()=>{},legacyError:String,legacyExitMessage:()=>''
 }}).ZhsQueuePanel;
 const makeStatus=(kind,stale)=>({...status,zhs_queue:{...status.zhs_queue,tasks:[
  {...status.zhs_queue.tasks[0],kind,percent:null,stale}
 ]}});
 for(const [kind,stale,expected] of [
  ['ppt',false,/非视频资源 · 不提供视频位置百分比/],
  ['article',false,/非视频资源 · 不提供视频位置百分比/],
  ['video',false,/正在等待本视频的有效采样/],
  ['video',true,/视频采样暂不可用/]
 ]){
  let view;
  try{
   await act(async()=>{view=create(React.createElement(Panel,{status:makeStatus(kind,stale),onRefresh:async()=>{}}));});
   assert.match(words(view.root),expected);
   if(kind!=='video')assert.doesNotMatch(words(view.root),/视频采样暂不可用/);
   assert.equal(view.root.findAllByProps({role:'progressbar'}).filter(x=>x.props['aria-valuenow']!==undefined).length,0);
  }finally{if(view)act(()=>view.unmount());}
 }
});


test('failed or stopped video rows stay visible as a summary even with collapsed history',async()=>{
 const Panel=load('components/ZhsQueuePanel.tsx',{'legacyPlayback.ts':{
   stopZhsVideo:async()=>{},legacyError:String,legacyExitMessage:()=>'',zhsDiagnosticMessage:()=>''
 }}).ZhsQueuePanel;
 const tasks=[
   {...status.zhs_queue.tasks[0],state:'failed',exit_code:13,percent:null,stale:true,name:'错误章节'},
   {...status.zhs_queue.tasks[1],state:'stopped',exit_code:null,percent:null,stale:false,name:'提前停止的章节'},
 ];
 let view;
 try{
   await act(async()=>{view=create(React.createElement(Panel,{status:{
     ...status,zhs_queue:{...status.zhs_queue,tasks}
   },onRefresh:async()=>{}}));});
   assert.match(words(view.root),/本轮异常记录：失败 1 项、已停止 1 项/);
   assert.match(words(view.root),/错误章节（退出码 13）/);
   assert.match(words(view.root),/本轮记录 · 2 项/);
 }finally{if(view)await act(async()=>view.unmount());}
});
