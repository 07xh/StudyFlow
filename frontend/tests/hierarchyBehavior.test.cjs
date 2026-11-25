const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');
const words=node=>typeof node==='string'?node:(node.children??[]).map(words).join('');
function browser(){const before=global.window;global.window={localStorage:{getItem:()=>null,setItem:()=>{}},setInterval:()=>1,clearInterval:()=>{}};return ()=>{if(before===undefined)delete global.window;else global.window=before;};}

test('global and unverified header contexts have no percentage track, verified metric keeps its actual meaning',()=>{
 const restore=browser();let view;
 const Shell=load('ui/AppShell.tsx').AppShell;
 const base={page:'settings',onNavigate:()=>{},dark:false,onThemeToggle:()=>{},onRefresh:()=>{},desktop:false,notice:'',onDismissNotice:()=>{},compact:false};
 try{
  act(()=>{view=create(React.createElement(Shell,base));});
  assert.equal(view.root.findAllByProps({role:'progressbar'}).length,0);
  act(()=>view.update(React.createElement(Shell,{...base,page:'platform-zhidao',currentCourseTitle:'A',courseProgress:null,metricLabel:'满进度知识点占比',courseEvidence:'历史缓存待核验'})));
  assert.equal(view.root.findAllByProps({role:'progressbar'}).length,0);
  assert.match(words(view.root),/满进度知识点占比.*历史缓存待核验/);
  act(()=>view.update(React.createElement(Shell,{...base,page:'platform-zhidao',currentCourseTitle:'A',courseProgress:40,metricLabel:'满进度知识点占比',courseEvidence:'服务器已核验'})));
  assert.equal(view.root.findByProps({role:'progressbar'}).props['aria-valuenow'],40);
  assert.equal(view.root.findByProps({role:'progressbar'}).props['aria-label'],'满进度知识点占比');
 }finally{if(view)act(()=>view.unmount());restore();}
});
test('retired official player settings are absent from the app entry',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const src=path.join(__dirname,'../src');
 assert.equal(fs.existsSync(path.join(src,'components/ZhidaoPlayerSettingsPanel.tsx')),false);
 assert.doesNotMatch(fs.readFileSync(path.join(src,'App.tsx'),'utf8'),/ZhidaoPlayerSettingsPanel/);
});
test('a run that changed since display cannot be stopped through the old task card',async()=>{
 const calls=[];
 const {stopRuntime}=load('runtimeTasks.ts',{'@tauri-apps/api/core':{invoke:async command=>{calls.push(command);return {state:'running',runId:'new-run',courseKey:'B'};}}});
 await assert.rejects(()=>stopRuntime({runner:'official',platform:'zhidao',state:'running',courseId:'A',runId:'old-run',exitCode:null}),/运行任务已变化/);
 assert.deepEqual(calls,['zhidao_player_status']);
});
test('platform batch tasks show their scope and zero-exit is not labeled learning completion',()=>{
 const Panel=load('components/RuntimeTaskList.tsx').RuntimeTaskList;let view;
 try{
  act(()=>{view=create(React.createElement(Panel,{tasks:[{runner:'yuketang',platform:'yuketang',state:'exited',courseId:null,runId:'test-run',exitCode:0}],events:[],courses:[],desktop:false,onInspect:()=>{},onRefresh:async()=>{}}));});
  const text=words(view.root);
  assert.match(text,/按雨课堂已配置的课堂范围批量运行/);assert.match(text,/完成情况待核验/);assert.doesNotMatch(text,/学习已完成/);
 }finally{if(view)act(()=>view.unmount());}
});
test('stopping a confirmed official run passes its expected identity to the atomic native gate',async()=>{
 const calls=[];
 const {stopRuntime}=load('runtimeTasks.ts',{'@tauri-apps/api/core':{invoke:async (command,args)=>{calls.push({command,args});return {state:'running',runId:'same-run',courseKey:'A'};}}});
 await stopRuntime({runner:'official',platform:'zhidao',state:'running',courseId:'A',runId:'same-run',exitCode:null});
 assert.deepEqual(calls[1],{command:'zhidao_player_stop',args:{expectedRunId:'same-run'}});
});
