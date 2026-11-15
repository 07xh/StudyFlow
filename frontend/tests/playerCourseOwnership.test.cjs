const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');
const words=n=>n.children.map(c=>typeof c==='string'?c:words(c)).join('');
const a={course_id:'course-A',title:'Course A',platform:'zhidao',course_type:'shared'};
const b={...a,course_id:'course-B',title:'Course B'};
function browser(){const old=global.window;global.window={localStorage:{getItem:()=>null,setItem:()=>{}},setInterval:()=>1,clearInterval:()=>{}};return ()=>{if(old===undefined)delete global.window;else global.window=old;};}
const state={state:'running',courseKey:a.course_id,runId:'run-A',exitCode:null,event:'timeupdate',positionSeconds:41,durationSeconds:120,visible:true,observedAt:'2026-11-14T12:00:00Z',message:'A playback message'};

test('viewing B never exposes A playback samples or an enabled stop for A',async()=>{
 const restore=browser();let view;
 const Panel=load('components/ZhidaoOfficialPlayerPanel.tsx',{
  '@tauri-apps/api/core':{invoke:async()=>state},
  'bridge.ts':{request:async()=>({speed:'1.5',mode:'official',autoStart:true,autoNext:true,allowMinimize:true}),friendlyBridgeError:String}
 }).ZhidaoOfficialPlayerPanel;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{courses:[a,b],courseId:b.course_id,desktop:true,detailMode:true}));});
  const text=JSON.stringify(view.toJSON());
  assert.doesNotMatch(text,/00:41|A playback message/);
  assert.match(text,/Course A/);
  const stop=view.root.findAllByType('button').find(n=>words(n).includes('停止播放器'));
  assert.equal(stop.props.disabled,true);
 }finally{if(view)act(()=>view.unmount());restore();}
});

test('switching from A to B clears the old run observation history',async()=>{
 const restore=browser();let view;
 const Panel=load('components/ZhidaoOfficialPlayerPanel.tsx',{
  '@tauri-apps/api/core':{invoke:async()=>state},
  'bridge.ts':{request:async()=>({speed:'1.5',mode:'official',autoStart:true,autoNext:true,allowMinimize:true}),friendlyBridgeError:String}
 }).ZhidaoOfficialPlayerPanel;
 try{
  const props={courses:[a,b],desktop:true,detailMode:true};
  await act(async()=>{view=create(React.createElement(Panel,{...props,courseId:a.course_id}));});
  assert.match(JSON.stringify(view.toJSON()),/00:41/);
  await act(async()=>view.update(React.createElement(Panel,{...props,courseId:b.course_id})));
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/00:41|A playback message/);
 }finally{if(view)act(()=>view.unmount());restore();}
});
