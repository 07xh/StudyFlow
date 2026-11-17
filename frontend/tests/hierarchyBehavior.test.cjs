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
test('saving player defaults preserves a concurrently changed platform mode and only saves after editing',async()=>{
 const restore=browser();let view;const writes=[];let reads=0;
 const original={speed:'1.5',mode:'official',autoStart:true,autoNext:true,allowMinimize:true};
 let persisted={...original};
 const Panel=load('components/ZhidaoPlayerSettingsPanel.tsx',{'bridge.ts':{friendlyBridgeError:String,request:async input=>{
  if(input.operation==='zhidao.player.settings.get')return {...persisted,mode:reads++===0?'official':'zhs-original'};
  writes.push(input.settings);persisted={...input.settings};return input.settings;
 }}}).ZhidaoPlayerSettingsPanel;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{desktop:true}));});
  const save=()=>view.root.findAllByType('button').find(button=>words(button)==='保存默认参数');
  assert.equal(save().props.disabled,true);
  act(()=>view.root.findByType('select').props.onChange({target:{value:'2'}}));
  assert.equal(save().props.disabled,false);
  await act(async()=>save().props.onClick());
  assert.equal(writes.length,1);assert.equal(writes[0].speed,'2');assert.equal(writes[0].mode,'zhs-original');
  assert.match(words(view.root),/下次启动播放器时生效/);
 }finally{if(view)act(()=>view.unmount());restore();}
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
