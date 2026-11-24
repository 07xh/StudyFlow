const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');
const words=n=>typeof n==='string'?n:(n.children??[]).map(words).join('');

test('classroom scope saves in its own section without resending credentials or an unchanged Sign',async()=>{
 const previous=global.window;const memory=new Map();
 global.window={localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}};
 const writes=[];let shell,view;
 const statuses=[{platform:'zhidao',status:'not_connected',courses:[]},{platform:'yuketang',status:'connected',courses:[]}];
 const scope={classroom_id:'11',university_id:'22',has_session:true,has_sign:true};
 const Null=()=>null;
 const App=load('App.tsx',{
  'bridge.ts':{isDesktop:()=>true,friendlyBridgeError:String,fetchStatuses:async()=>statuses,request:async input=>{
   if(input.operation==='yuketang.scope.get')return scope;
   if(input.operation==='yuketang.scope.save'){writes.push(input);return {...scope,...input.scope};}
   return {mode:'official'};
  }},
  'runtimeTasks.ts':{useRuntimeTasks:()=>({tasks:[],loading:false,refresh:async()=>{}})},
  'ui/useAppearance.ts':{useAppearance:()=>({dark:false,mode:'light',setMode:()=>{},toggleTheme:()=>{}})},
  'ui/AppShell.tsx':{AppShell:props=>{shell=props;return props.children;}},
  'ui/CollapsibleSection.tsx':{CollapsibleSection:props=>props.children},
  'components/StudyFlowConsentGate.tsx':{StudyFlowConsentGate:props=>{React.useEffect(()=>props.onAccepted(),[]);return null;}},
  'components/UpdatePanel.tsx':{UpdatePanel:Null},
  'components/ZhidaoPlayerMonitor.tsx':{ZhidaoPlayerMonitor:Null},
  'components/YuketangTaskArea.tsx':{YuketangTaskArea:Null},
  'ui/SettingsDialog.tsx':{SettingsDialog:({open,children,navigation})=>open?React.createElement(React.Fragment,null,navigation,children):null}
 }).default;
 try{
  await act(async()=>{view=create(React.createElement(App));});
  act(()=>shell.onNavigate('platform-yuketang'));
  assert.equal(view.root.findAllByType('input').some(n=>n.props.value==='11'),false,
    'Classroom scope must not be rendered on the platform course home');
  const settingsAction=view.root.findAllByType('button').find(n=>words(n)==='平台设置');
  assert.ok(settingsAction,'Platform settings must remain directly accessible');
  act(()=>settingsAction.props.onClick());
  const advanced=view.root.findAllByType('button').find(n=>words(n)==='高级管理');
  assert.ok(advanced);
  act(()=>advanced.props.onClick());
  assert.equal(view.root.findAllByType('input').find(n=>n.props.value==='11').props.type,'text');
  act(()=>view.root.findAllByType('input').find(n=>n.props.value==='11').props.onChange({target:{value:'33'}}));
  const button=label=>view.root.findAllByType('button').find(n=>words(n)===label);
  assert.equal(button('保存课堂范围').props.disabled,false);
  assert.equal(button('读取已配置课堂的章节视频').props.disabled,true);
  await act(async()=>button('保存课堂范围').props.onClick());
  assert.deepEqual(writes,[{operation:'yuketang.scope.save',scope:{classroom_id:'33',university_id:'22'}}]);
  assert.equal(button('保存课堂范围').props.disabled,true);
  assert.equal(button('读取已配置课堂的章节视频').props.disabled,false);
  assert.equal(view.root.findAllByType('input').some(n=>n.props.placeholder==='已保存，修改后替换'),true);
 }finally{if(view)act(()=>view.unmount());if(previous===undefined)delete global.window;else global.window=previous;}
});
