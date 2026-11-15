const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {act,create}=require('react-test-renderer');
const load=require('./helpers/load.cjs');
const words=node=>typeof node==='string'?node:(node.children??[]).map(words).join('');
const empty={session_id:'sample-session',csrf_token:'sample-csrf',classroom_id:'',university_id:'',sign:''};

test('required scope reports each missing or malformed ID, and no private session content',()=>{
  const {yuketangScopeIssues}=load('yuketangScopeValidation.ts');
  assert.deepEqual(yuketangScopeIssues(empty),['未填写课堂 ID','未填写学校 ID']);
  assert.deepEqual(yuketangScopeIssues({...empty,classroom_id:'12',university_id:''}),['未填写学校 ID']);
  assert.deepEqual(yuketangScopeIssues({...empty,classroom_id:'letters',university_id:'1'.repeat(25)}),
    ['课堂 ID 应为 1–24 位数字','学校 ID 应为 1–24 位数字']);
  assert.deepEqual(yuketangScopeIssues({...empty,classroom_id:' 123 ',university_id:'456'}),[]);
  assert.doesNotMatch(yuketangScopeIssues(empty).join(';'),/sample-session|sample-csrf/);
});

test('account form blocks save, names missing fields and offers an actionable scope shortcut',async()=>{
  const {YuketangLoginPanel}=load('components/YuketangLoginPanel.tsx');
  let saves=0,jumps=0;
  let view;
  await act(async()=>{view=create(React.createElement(YuketangLoginPanel,{
    config:empty,desktop:true,busy:false,connected:false,
    onChange:()=>{},onSubmit:()=>{saves++;},onOpenScope:()=>{jumps++;},
    onClear:()=>{}
  }));});
  try{
    await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
    assert.equal(saves,0,'missing IDs must never reach backend save');
    const snapshot=JSON.stringify(view.toJSON());
    assert.match(snapshot,/尚未保存：课堂信息不完整/);
    assert.match(snapshot,/未填写课堂 ID/);
    assert.match(snapshot,/未填写学校 ID/);
    assert.doesNotMatch(snapshot,/href.*sf-ykt-content/,'the old inert anchor must be removed');
    const jump=view.root.findAllByType('button').find(n=>words(n)==='前往填写课堂 ID、学校 ID');
    assert.ok(jump);
    await act(async()=>jump.props.onClick());
    assert.equal(jumps,1);
  }finally{act(()=>view.unmount());}
});

test('scope shortcut opens a previously collapsed section and preserves entered session fields',async()=>{
  const old=global.window;
  const store=new Map([['studyflow.section.expanded.v1.platform:yuketang:content','false']]);
  global.window={localStorage:{
    getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)
  }};
  const sent=[];
  const statuses=[
    {platform:'zhidao',status:'not_connected',courses:[]},
    {platform:'yuketang',status:'not_connected',courses:[]}
  ];
  let shell,view;
  const Null=()=>null;
  const App=load('App.tsx',{
    'bridge.ts':{
      isDesktop:()=>true,friendlyBridgeError:String,
      fetchStatuses:async()=>statuses,fetchCoursesFromDesktop:async()=>[],
      request:async request=>{
        if(request.operation==='yuketang.scope.get')return {
          classroom_id:'',university_id:'',has_session:false,has_sign:false
        };
        if(request.operation==='yuketang.configure'){sent.push(request);return {saved:true};}
        return {mode:'official'};
      }
    },
    'runtimeTasks.ts':{useRuntimeTasks:()=>({tasks:[],loading:false,refresh:async()=>{}})},
    'ui/useAppearance.ts':{useAppearance:()=>({dark:false,mode:'light',setMode:()=>{},toggleTheme:()=>{}})},
    'ui/AppShell.tsx':{AppShell:props=>{shell=props;return props.children;}},
    'components/StudyFlowConsentGate.tsx':{StudyFlowConsentGate:props=>{
      React.useEffect(()=>props.onAccepted(),[]);return null;
    }},
    'components/UpdatePanel.tsx':{UpdatePanel:Null},
    'components/ZhidaoPlayerMonitor.tsx':{ZhidaoPlayerMonitor:Null},
    'components/YuketangTaskArea.tsx':{YuketangTaskArea:Null},
    'ui/SettingsDialog.tsx':{SettingsDialog:({open,children})=>open?children:null}
  }).default;
  const button=label=>view.root.findAllByType('button').find(n=>words(n)===label);
  try{
    await act(async()=>{view=create(React.createElement(App));});
    await act(async()=>shell.onNavigate('platform-yuketang'));
    await act(async()=>button('账号与连接').props.onClick());
    const inputs=view.root.findAllByType('input').filter(n=>n.props.type==='password');
    assert.ok(inputs.length>=2);
    await act(async()=>{
      inputs[0].props.onChange({target:{value:'sample-session'}});
      inputs[1].props.onChange({target:{value:'sample-csrf'}});
    });
    await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
    assert.equal(sent.length,0);
    assert.match(JSON.stringify(view.toJSON()),/未填写课堂 ID/);
    await act(async()=>button('前往填写课堂 ID、学校 ID').props.onClick());
    const fold=view.root.findAllByType('button').find(n=>
      String(n.props['aria-label']??'').includes('课堂范围与章节内容'));
    assert.ok(fold);
    assert.equal(fold.props['aria-expanded'],true,
      'jump must override a previously persisted collapsed section');
    const field=label=>view.root.findAllByType('label').find(n=>words(n).includes(label)).findByType('input');
    await act(async()=>{
      field('课堂 ID').props.onChange({target:{value:'123'}});
      field('学校 ID').props.onChange({target:{value:'456'}});
    });
    await act(async()=>button('账号与连接').props.onClick());
    const newInputs=view.root.findAllByType('input').filter(n=>n.props.type==='password');
    assert.equal(newInputs[0].props.value,'sample-session');
    assert.equal(newInputs[1].props.value,'sample-csrf');
    await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
    assert.equal(sent.length,1);
    assert.equal(sent[0].configuration.classroom_id,'123');
    assert.equal(sent[0].configuration.university_id,'456');
    assert.equal(sent[0].configuration.session_id,'sample-session');
    assert.equal(sent[0].configuration.csrf_token,'sample-csrf');
    assert.deepEqual(sent.map(x=>x.operation),['yuketang.configure']);
  }finally{
    if(view)act(()=>view.unmount());
    if(old===undefined)delete global.window;
    else global.window=old;
  }
});
