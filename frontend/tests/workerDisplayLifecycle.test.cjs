const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {create,act}=require('react-test-renderer');

async function renderStatus(state,progress){
 const text=fs.readFileSync(path.join(__dirname,'../src/components/LegacyPlaybackPanel.tsx'),'utf8');
 const code=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const mod={exports:{}};
 const options={use_concurrent:progress.concurrent!==false,max_concurrent_videos:2};
 const legacy={originalYktDefaults:options,validateOriginalOptions:()=>true,legacyExitMessage:()=>"进程已退出",
  getLegacyStatus:async()=>({state,run_id:'1-2'}),getYuketangLiveProgress:async()=>progress};
 new Function('module','exports','require',code)(mod,mod.exports,name=>{
  if(name==='../legacyPlayback')return legacy;
  if(name==='../taskRecovery')return {rememberTaskRecovery:()=>true,discardTaskRecovery:()=>{}};
  if(name==='./RunParameters')return require('./helpers/load.cjs')('components/RunParameters.tsx');
   if(name==='./ZhsTaskSettingsPanel')return {ZhsTaskSettingsPanel:()=>null};
  if(name==='../bridge')return {request:async()=>({}),friendlyBridgeError:String};
  if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
  return require(name);
 });
 const previousWindow=global.window;
 global.window={setInterval:()=>1,clearInterval:()=>{}};
 let view;
 try{
  await act(async()=>{view=create(React.createElement(mod.exports.LegacyPlaybackPanel,{
   platform:'yuketang',desktop:true,connected:true,courses:[],yuketangOptions:options
  }));});
  const cards=view.root.findAll(n=>n.props.className==='sf-ykt-worker');
  return cards.map(card=>JSON.stringify({
   small:card.findAllByType('small').map(n=>n.children),
   labels:card.findAllByType('span').map(n=>n.children),
   strong:card.findAllByType('strong').map(n=>n.children)
  }));
 }finally{
  if(view)act(()=>view.unmount());
  if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
 }
}
const progress={available:true,worker_slots:[],concurrent:true,simulation_percent:40,processed:0,success:0,skipped:0,failed:0,stopped:0};

test('a truncated running log never turns absent worker identity into waiting evidence',async()=>{
 const cards=await renderStatus('running',progress);
 assert.equal(cards.length,2);
 for(const card of cards){assert.match(card,/状态待核实/);assert.doesNotMatch(card,/等待分配|尚未分配视频/);}
});
test('serial logs without Worker events show unknown attribution rather than a waiting worker',async()=>{
 const cards=await renderStatus('running',{...progress,concurrent:false});
 assert.equal(cards.length,1);
 assert.match(cards[0],/状态待核实/);
 assert.doesNotMatch(cards[0],/等待分配|尚未分配视频/);
});
test('process exit clears executing labels while retaining confirmed terminal worker results',async()=>{
 const cards=await renderStatus('exited',{...progress,worker_slots:[
  {slot:1,video_index:1,state:'watching'},{slot:2,video_index:2,state:'completed'}
 ]});
 assert.match(cards[0],/状态待核实/);
 assert.doesNotMatch(cards[0],/执行中/);
 assert.match(cards[1],/已完成/);
});


test('two concurrent video slots display only their own observed percentages',async()=>{
 const cards=await renderStatus('running',{
  ...progress,worker_slots:[
   {slot:1,video_index:1,state:'watching'},
   {slot:2,video_index:2,state:'preparing'}
  ],
  video_tasks:[
   {video_index:1,name:'第一讲',state:'watching',simulation_percent:40,simulation_position:48,
    simulation_duration:120,server_percent:22,server_position:26,server_source:'periodic'},
   {video_index:2,name:'第二讲',state:'preparing',simulation_percent:null,simulation_position:null,
    simulation_duration:80,server_percent:null,server_position:null,server_source:null}
  ]
 });
 assert.equal(cards.length,2);
 assert.match(cards[0],/第一讲/);
 assert.match(cards[0],/40\.0%/);
 assert.match(cards[0],/22\.0%/);
 assert.match(cards[1],/第二讲/);
 assert.doesNotMatch(cards[1],/40\.0%|22\.0%/);
 assert.match(cards[1],/尚未获得可归属的响应/);
});

test('the video view separates log observations from overall course completion',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../src/components/LegacyPlaybackPanel.tsx'),'utf8');
 assert.match(text,/逐视频详情/);
 assert.match(text,/videoTasks\.map/);
 assert.match(text,/YktVideoEvidence/);
 assert.match(text,/服务器返回/);
 assert.match(text,/未能归属的进度仍留空/);
 assert.doesNotMatch(text,/server_percent\s*\?\?\s*simulation_percent/);
});
