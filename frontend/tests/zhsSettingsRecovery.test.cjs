const test=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');

const key='a'.repeat(64);
const defaults={
  speed:1.5,speed_cap:2,limit_minutes:0,learn_optional:false,
  max_videos:0,stop_on_error:false,concurrency:2,completion_threshold:null
};
const textOf=node=>typeof node==='string'?node:
  (node.children??[]).map(textOf).join('');

test('failed ZHS settings read is visible and can be explicitly repaired without touching login',async()=>{
  const previous=global.window;
  let allowRestore=false;
  const calls=[],ready=[];
  global.window={
    confirm:()=>allowRestore,
    localStorage:{getItem:()=>null,setItem:()=>{}}
  };
  const Panel=load('components/ZhsTaskSettingsPanel.tsx',{
    'bridge.ts':{
      friendlyBridgeError:()=> 'ZHS 参数读取或保存失败，原版设置未修改。',
      request:async query=>{
        calls.push(query);
        if(query.operation==='zhidao.zhs.settings.get')throw new Error('ZHS_SETTINGS_UNAVAILABLE');
        if(query.operation==='zhidao.course.detail')
          return {course_key:key,verified:false,stale:false,items:[]};
        if(query.operation==='zhidao.zhs.settings.save')return query.settings;
        throw Error('Unexpected '+query.operation);
      }
    },
    'legacyPlayback.ts':{
      originalZhsDefaults:defaults,
      validateZhsStoredOptions:obj=>obj?.speed>=1&&obj?.speed<=2,
      validateZhsOptions:obj=>obj?.scope_mode==='all'
    },
    'ui/SettingsDialog.tsx':{SettingsDialog:({children})=>React.createElement('section',null,children)}
  }).ZhsTaskSettingsPanel;
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Panel,{
      desktop:true,courseId:key,courseType:'shared',onReady:v=>ready.push(v)
    }));});
    assert.match(textOf(view.root),/本课程参数读取失败/);
    assert.match(textOf(view.root),/重试读取/);
    assert.equal(ready.at(-1),null);
    const restore=()=>view.root.findAllByType('button')
      .find(node=>textOf(node).includes('恢复本课程默认参数'));
    assert.ok(restore());
    await act(async()=>{restore().props.onClick();});
    assert.equal(calls.filter(q=>q.operation==='zhidao.zhs.settings.save').length,0,
      'declined overwrite must leave the saved settings untouched');
    allowRestore=true;
    await act(async()=>{restore().props.onClick();});
    assert.equal(calls.filter(q=>q.operation==='zhidao.zhs.settings.save').length,1);
    assert.deepEqual(calls.find(q=>q.operation==='zhidao.zhs.settings.save').settings,defaults);
    assert.equal(ready.at(-1)?.scope_mode,'all');
    assert.equal(ready.at(-1)?.completion_threshold,null);
    assert.match(textOf(view.root),/本机参数已加载/);
  }finally{
    if(view)await act(async()=>view.unmount());
    if(previous===undefined)delete global.window;else global.window=previous;
  }
});
