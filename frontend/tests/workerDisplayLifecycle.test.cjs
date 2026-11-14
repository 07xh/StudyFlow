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
   labels:card.findAllByType('span').map(n=>n.children)
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
