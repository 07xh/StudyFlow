const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {act,create}=require('react-test-renderer');
const load=require('./helpers/load.cjs');

const course={platform:'xuexitong',course_id:'10:20:30',title:'只读状态校验',progress_percent:null};
const settings={playback_speed:1,concurrency:2,skip_completed:true,verify_after_run:true};
const task=(runId,title)=>({
 task_id:'task-'+runId,run_id:runId,course_key:course.course_id,
 chapter_id:'42',chapter:'第一章',title,state:'running',playing_time:120,
 duration:600,speed:1,last_send_state:'reported',sent_count:2,
 server_confirmed:false,server_play_time:0,end_reason:'',confirmed:false,resumable:true
});
const status=(runId,title)=>({
 ok:true,running:true,paused:false,run_id:runId,course_key:course.course_id,
 config:{speed:1,jobs:2,instant_complete:false,randomize_interval:false},
 task_count:1,tasks:[task(runId,title)],
 queue:{total_chapters:1,active_chapters:1,paused_chapters:0,
  queued_chapters:0,pending_tasks:0,running_tasks:1},
 heartbeats:{sent:2,server_confirmed:0},
 queue_controls:{pause:true,resume:false,stop:true}
});
const buttons=view=>view.root.findAllByType('button');
const byLabel=(view,label)=>buttons(view).find(x=>x.props.children===label);

test('log API rejection cannot hide valid live task status',async()=>{
 const {XuexitongHeartbeatPanel}=load('components/XuexitongHeartbeatPanel.tsx',{
  '../bridge':{
   request:async({operation})=>{
    if(operation==='xuexitong.settings.get')return settings;
    if(operation==='xuexitong.heartbeat.status')return status('live','运行中的任务');
    if(operation==='xuexitong.heartbeat.logs')throw Error('logs unavailable');
    throw Error('unexpected IPC');
   },
   friendlyBridgeError:e=>String(e)
  }
 });
 let view;
 try{
  await act(async()=>{view=create(React.createElement(XuexitongHeartbeatPanel,{course,desktop:true}));});
  const output=JSON.stringify(view.toJSON());
  assert.match(output,/运行中的任务/);
  assert.match(output,/日志暂不可用/);
  assert.doesNotMatch(output,/状态待核实/);
  assert.equal(byLabel(view,'暂停').props.disabled,false);
 }finally{if(view)await act(async()=>{view.unmount();});}
});

test('failed status poll hides cached run and blocks actions until retry succeeds',async()=>{
 let statusFails=false;
 const {XuexitongHeartbeatPanel}=load('components/XuexitongHeartbeatPanel.tsx',{
  '../bridge':{
   request:async({operation})=>{
    if(operation==='xuexitong.settings.get')return settings;
    if(operation==='xuexitong.heartbeat.status'){
     if(statusFails)throw Error('offline status');
     return status('live','先前任务');
    }
    if(operation==='xuexitong.heartbeat.logs')return {ok:true,events:[]};
    throw Error('unexpected IPC');
   },
   friendlyBridgeError:e=>String(e)
  }
 });
 let view;
 try{
  await act(async()=>{view=create(React.createElement(XuexitongHeartbeatPanel,{course,desktop:true}));});
  assert.match(JSON.stringify(view.toJSON()),/先前任务/);
  statusFails=true;
  await act(async()=>{byLabel(view,'刷新').props.onClick();});
  const stale=JSON.stringify(view.toJSON());
  assert.match(stale,/后台状态待核实/);
  assert.doesNotMatch(stale,/先前任务/);
  for(const label of ['开始','暂停','继续','停止'])
   assert.equal(byLabel(view,label).props.disabled,true,'stale status must block '+label);
  statusFails=false;
  await act(async()=>{byLabel(view,'刷新').props.onClick();});
  const restored=JSON.stringify(view.toJSON());
  assert.match(restored,/先前任务/);
  assert.doesNotMatch(restored,/后台状态待核实/);
  assert.equal(byLabel(view,'暂停').props.disabled,false);
 }finally{if(view)await act(async()=>{view.unmount();});}
});

test('hung old-run logs do not block a new-run status or its own log request',async()=>{
 let resolveOldLogs;const oldLogs=new Promise(resolve=>{resolveOldLogs=resolve;});
 let runId='old';let logCalls=0;
 const oldWindow=global.window;let tick;
 global.window={setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}};
 const {XuexitongHeartbeatPanel}=load('components/XuexitongHeartbeatPanel.tsx',{
  '../bridge':{
   request:async({operation})=>{
    if(operation==='xuexitong.settings.get')return settings;
    if(operation==='xuexitong.heartbeat.status')return status(runId,runId+' task');
    if(operation==='xuexitong.heartbeat.logs'){
     logCalls++;
     if(logCalls===1)return oldLogs;
     return {ok:true,events:[{event:'new-log',at:12,run_id:'new'}]};
    }
    throw Error('unexpected IPC');
   },
   friendlyBridgeError:e=>String(e)
  }
 });
 let view;
 try{
  await act(async()=>{view=create(React.createElement(XuexitongHeartbeatPanel,{course,desktop:true}));});
  assert.equal(logCalls,1);
  runId='new';
  await act(async()=>{tick();});
  const output=JSON.stringify(view.toJSON());
  assert.match(output,/new task/);
  assert.match(output,/new-log/);
  assert.doesNotMatch(output,/old task/);
  assert.equal(logCalls,2,'new run should not wait for a previous log request');
  await act(async()=>{resolveOldLogs({ok:true,events:[{event:'obsolete',at:1,run_id:'old'}]});});
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/obsolete/);
 }finally{
  if(view)await act(async()=>{view.unmount();});
  if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
 }
});
