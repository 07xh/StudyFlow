const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const courseKey="b".repeat(64);
const defaults={
  speed:1.5,speed_cap:2,limit_minutes:0,learn_optional:false,
  max_videos:0,stop_on_error:false,concurrency:2,completion_threshold:null
};
const textOf=node=>typeof node==="string"?node:
  (node.children??[]).map(textOf).join("");

test("ZHS scope is a draft: save, close, reopen and new panel mount reload exact persisted scope",async()=>{
  const previous=global.window;
  const storage=new Map();
  const calls=[];
  let allowDiscard=false;
  let persisted={...defaults};
  global.window={
    confirm:()=>allowDiscard,
    localStorage:{
      getItem:key=>storage.get(key)??null,
      setItem:(key,value)=>storage.set(key,value)
    }
  };
  const Panel=load("components/ZhsTaskSettingsPanel.tsx",{
    "bridge.ts":{
      friendlyBridgeError:e=>String(e),
      request:async msg=>{
        calls.push(msg);
        if(msg.operation==="zhidao.zhs.settings.get")return {...persisted};
        if(msg.operation==="zhidao.zhs.settings.save"){
          persisted={...msg.settings};return {...persisted};
        }
        if(msg.operation==="zhidao.course.detail")
          return {course_key:courseKey,course_type:"shared",verified:false,stale:false,items:[]};
        throw Error("Unexpected operation "+msg.operation);
      }
    },
    "legacyPlayback.ts":{
      originalZhsDefaults:defaults,
      validateZhsStoredOptions:obj=>Object.keys(defaults).every(k=>obj?.[k]!==undefined||defaults[k]===null&&obj?.[k]===null),
      validateZhsOptions:obj=>obj?.scope_mode==="all"
    },
    "ui/SettingsDialog.tsx":{
      SettingsDialog:({open,onClose,children,footer,navigation})=>open?
        React.createElement("section",null,
          React.createElement("button",{id:"close-zhs",onClick:onClose},"关闭"),
          navigation,children,footer
        ):null
    }
  }).ZhsTaskSettingsPanel;
  const props={desktop:true,courseId:courseKey,courseType:"shared"};
  const key="studyflow.zhs.task.scope."+courseKey;
  let view;
  const open=()=>view.root.findAllByType("button").find(n=>textOf(n).includes("点击设置"));
  const close=()=>view.root.findByProps({id:"close-zhs"});
  const scopeTab=()=>view.root.findAllByType("button").find(n=>textOf(n)==="课程范围");
  const chooseScope=async()=>act(async()=>{scopeTab().props.onClick();});
  const mode=()=>view.root.findAllByType("label")
    .find(n=>textOf(n).includes("本次选择的资源类型")).findByType("select");
  const save=()=>view.root.findAllByType("button")
    .find(n=>textOf(n).includes("保存参数"));
  try{
    await act(async()=>{view=create(React.createElement(Panel,props));});
    await act(async()=>{open().props.onClick();});
    await chooseScope();
    await act(async()=>{mode().props.onChange({target:{value:"video"}});});
    assert.equal(storage.has(key),false,"unsaved scope must never touch browser storage");
    assert.equal(save().props.disabled,false);

    await act(async()=>{close().props.onClick();});
    assert.ok(close(),"declining discard must leave the modal open");
    assert.equal(storage.has(key),false);

    allowDiscard=true;
    await act(async()=>{close().props.onClick();});
    await act(async()=>{open().props.onClick();});
    await chooseScope();
    assert.equal(mode().props.value,"all","discard must restore the last saved value");

    await act(async()=>{mode().props.onChange({target:{value:"video"}});});
    await act(async()=>{save().props.onClick();});
    assert.equal(JSON.parse(storage.get(key)).resourceMode,"video");
    assert.equal(save().props.disabled,true);
    assert.ok(calls.some(c=>c.operation==="zhidao.zhs.settings.save"));

    await act(async()=>{close().props.onClick();});
    await act(async()=>{open().props.onClick();});
    await chooseScope();
    assert.equal(mode().props.value,"video");
    await act(async()=>{view.unmount();});
    view=null;

    // New React tree, like a new EXE window. The real EXE lifecycle is
    // separately tested, not inferred from this simulation.
    await act(async()=>{view=create(React.createElement(Panel,props));});
    await act(async()=>{open().props.onClick();});
    await chooseScope();
    assert.equal(mode().props.value,"video");
  }finally{
    if(view)await act(async()=>view.unmount());
    if(previous===undefined)delete global.window;else global.window=previous;
  }
});

test("AI-only resource mode is saved per course and survives reopening",async()=>{
  const previous=global.window;
  const storage=new Map();
  const calls=[],ready=[];
  let persisted={...defaults};
  global.window={
    confirm:()=>true,
    localStorage:{getItem:key=>storage.get(key)??null,
      setItem:(key,value)=>storage.set(key,value)}
  };
  const Panel=load("components/ZhsTaskSettingsPanel.tsx",{
    "bridge.ts":{
      friendlyBridgeError:String,
      request:async msg=>{
        calls.push(msg);
        if(msg.operation==="zhidao.zhs.settings.get")return {...persisted};
        if(msg.operation==="zhidao.zhs.settings.save"){
          persisted={...msg.settings};return {...persisted};
        }
        if(msg.operation==="zhidao.course.detail")
          return {course_key:courseKey,course_type:"ai",verified:false,stale:false,items:[]};
        throw Error("Unexpected operation "+msg.operation);
      }
    },
    "legacyPlayback.ts":{
      originalZhsDefaults:defaults,
      validateZhsStoredOptions:obj=>Object.keys(defaults).every(k=>obj?.[k]!==undefined||
        (defaults[k]===null&&obj?.[k]===null)),
      validateZhsOptions:obj=>obj?.scope_mode==="all" &&
        obj.learn_optional===(obj.requirement_mode!=="required")
    },
    "ui/SettingsDialog.tsx":{
      SettingsDialog:({open,onClose,children,footer,navigation})=>open?
        React.createElement("section",null,
          React.createElement("button",{id:"close-zhs",onClick:onClose},"关闭"),
          navigation,children,footer):null
    }
  }).ZhsTaskSettingsPanel;
  const key="studyflow.zhs.task.scope."+courseKey;
  const props={desktop:true,courseId:courseKey,courseType:"ai",
    onReady:value=>ready.push(value)};
  let view;
  const open=()=>view.root.findAllByType("button").find(n=>textOf(n).includes("点击设置"));
  const scopeTab=()=>view.root.findAllByType("button").find(n=>textOf(n)==="课程范围");
  const mode=()=>view.root.findAllByType("label")
    .find(n=>textOf(n).includes("AI 任务类型")).findByType("select");
  const save=()=>view.root.findAllByType("button").find(n=>textOf(n).includes("保存参数"));
  try{
    await act(async()=>{view=create(React.createElement(Panel,props));});
    await act(async()=>{open().props.onClick();});
    await act(async()=>{scopeTab().props.onClick();});
    assert.equal(mode().props.value,"required");
    await act(async()=>{mode().props.onChange({target:{value:"optional"}});});
    assert.equal(save().props.disabled,false);
    assert.equal(storage.has(key),false,"unsaved mode must not be persisted");
    await act(async()=>{save().props.onClick();});
    assert.equal(persisted.learn_optional,true);
    assert.equal(JSON.parse(storage.get(key)).requirementMode,"optional");
    assert.equal(ready.at(-1)?.requirement_mode,"optional");

    await act(async()=>{mode().props.onChange({target:{value:"both"}});});
    await act(async()=>{save().props.onClick();});
    assert.equal(persisted.learn_optional,true);
    assert.equal(JSON.parse(storage.get(key)).requirementMode,"both");
    assert.equal(ready.at(-1)?.requirement_mode,"both");

    await act(async()=>{mode().props.onChange({target:{value:"required"}});});
    await act(async()=>{save().props.onClick();});
    assert.equal(persisted.learn_optional,false);
    assert.equal(JSON.parse(storage.get(key)).requirementMode,"required");
    await act(async()=>view.unmount());view=null;
    await act(async()=>{view=create(React.createElement(Panel,props));});
    await act(async()=>{open().props.onClick();});
    await act(async()=>{scopeTab().props.onClick();});
    assert.equal(mode().props.value,"required");
    assert.equal(ready.at(-1)?.requirement_mode,"required");
  }finally{
    if(view)await act(async()=>view.unmount());
    if(previous===undefined)delete global.window;else global.window=previous;
  }
});
