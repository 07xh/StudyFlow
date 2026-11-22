const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const COURSE="a".repeat(64);
const ID="b".repeat(32);
const empty={state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[]};
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");

test("mastery auto inherits shared-bank token strategy without exposing a secret",async()=>{
  const original=global.window;
  global.window={setInterval:()=>12,clearInterval:()=>{},
                 setTimeout:()=>13,clearTimeout:()=>{}};
  const calls=[];
  const mocks={
    masteryAutoStatus:async()=>empty,
    masteryAutoStart:async(course,options)=>{calls.push([course,options]);return empty;},
    masteryAutoControl:async()=>empty,
    masteryCatalog:async()=>({knowledge:[{chapter_index:1,theme:"第一章",knowledge_id:"1001"},{chapter_index:2,theme:"第二章",knowledge_id:"1002"}]}),
    questionBankList:async()=>({providers:[{id:"yanxi",name:"言溪题库",description:""}],
      tokens:[{id:ID,provider_id:"yanxi",label:"第一个 Token",active:true}]}),
    friendlyBridgeError:error=>String(error?.message||error),
  };
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":mocks});
    await act(async()=>{view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));});
    assert.equal(calls.length,0,"loading the page should not auto-query or start the worker");
    const checkbox=view.root.findAllByType("input").find(input=>input.props.type==="checkbox");
    assert.ok(checkbox);
    await act(async()=>checkbox.props.onChange({target:{checked:true}}));
    assert.match(textOf(view.root),/Token 使用方式/);
    assert.match(textOf(view.root),/第一个 Token/);
    const start=view.root.findAllByType("button").find(b=>textOf(b).includes("开始执行"));
    assert.ok(start&&!start.props.disabled);
    await act(async()=>start.props.onClick());
    assert.equal(calls.length,1);
    assert.equal(calls[0][0],COURSE);
    assert.equal(calls[0][1].use_external_bank,true);
    assert.equal(calls[0][1].external_provider_id,"yanxi");
    assert.equal(calls[0][1].external_token_id,"");
    assert.equal(calls[0][1].max_external_calls,40);
    assert.doesNotMatch(JSON.stringify(calls),/sk-secret-token/);
  }finally{
    if(view)act(()=>view.unmount());
    global.window=original;
  }
});

test("mastery auto refuses to start external queries when no Token is configured",async()=>{
  const original=global.window;
  global.window={setInterval:()=>12,clearInterval:()=>{},
                 setTimeout:()=>13,clearTimeout:()=>{}};
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async()=>empty,masteryAutoStart:async()=>{throw Error("should not start");},
      masteryAutoControl:async()=>empty,
      masteryCatalog:async()=>({knowledge:[{chapter_index:1,theme:"第一章",knowledge_id:"1001"}]}),
      questionBankList:async()=>({
        providers:[{id:"yanxi",name:"言溪题库",description:""}],tokens:[]}),
      friendlyBridgeError:()=> "失败",
    }});
    await act(async()=>{view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));});
    const checkbox=view.root.findAllByType("input").find(input=>input.props.type==="checkbox");
    await act(async()=>checkbox.props.onChange({target:{checked:true}}));
    const button=view.root.findAllByType("button").find(b=>textOf(b).includes("开始执行"));
    assert.ok(button.props.disabled);
    assert.match(textOf(view.root),/请先到/);
  }finally{
    if(view)act(()=>view.unmount());
    global.window=original;
  }
});


test("single-chapter selection sends selected real chapter index instead of whole course",async()=>{
  const original=global.window;
  global.window={setInterval:()=>12,clearInterval:()=>{},
                 setTimeout:()=>13,clearTimeout:()=>{}};
  const launches=[];
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async()=>empty,
      masteryAutoStart:async(course,settings)=>{
        launches.push([course,settings]);return empty;},
      masteryAutoControl:async()=>empty,
      masteryCatalog:async()=>({knowledge:[
        {chapter_index:1,theme:"绪论",knowledge_id:"1001"},
        {chapter_index:1,theme:"绪论",knowledge_id:"1002"},
        {chapter_index:2,theme:"第一章",knowledge_id:"1003"},
      ]}),
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:err=>String(err),
    }});
    await act(async()=>{view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));});
    const one=view.root.findAllByType("button").find(b=>textOf(b)==="只做一章");
    await act(async()=>one.props.onClick());
    const choice=view.root.findAllByType("select").find(s=>s.props.value===1);
    assert.ok(choice,"single chapter selector should list actual chapters");
    await act(async()=>choice.props.onChange({target:{value:"2"}}));
    assert.match(textOf(view.root),/本次选择 1\/2 章 · 1 个知识点/);
    const go=view.root.findAllByType("button").find(b=>textOf(b).includes("开始执行"));
    assert.ok(!go.props.disabled);
    await act(async()=>go.props.onClick());
    assert.equal(launches.length,1);
    assert.equal(launches[0][1].scope_mode,"single");
    assert.deepEqual(launches[0][1].chapter_indices,[2]);
    assert.equal(launches[0][1].chapter_count,1);
  }finally{
    if(view)act(()=>view.unmount());
    global.window=original;
  }
});

test("pausing status exposes finish-current behavior and keeps live task visible",async()=>{
  const original=global.window;
  global.window={setInterval:()=>12,clearInterval:()=>{},
                 setTimeout:()=>13,clearTimeout:()=>{}};
  const pauses=[];
  const current={knowledge_id:"1001",theme:"绪论",name:"知识点一"};
  const status={state:"pausing",total:2,processed:0,done:0,skipped:0,
    current,chapter_total:1,selected_chapters:[{index:1,name:"绪论",knowledge_count:2}],
    tasks:[{...current,chapter_index:1,mastery:58,state:"working",rounds:2,reason:"提交核验中"},
      {knowledge_id:"1002",theme:"绪论",name:"知识点二",chapter_index:1,
       mastery:10,state:"pending",rounds:0,reason:""}]};
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async()=>status,
      masteryAutoStart:async()=>{throw Error("already running");},
      masteryAutoControl:async(...args)=>{pauses.push(args);return {...status,state:"running"};},
      masteryCatalog:async()=>({knowledge:[]}),
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:err=>String(err),
    }});
    await act(async()=>{view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));});
    assert.match(textOf(view.root),/完成当前知识点后暂停/);
    assert.match(textOf(view.root),/知识点一/);
    assert.match(textOf(view.root),/提交核验中/);
    const cancel=view.root.findAllByType("button").find(b=>textOf(b).includes("取消待暂停"));
    assert.ok(cancel&&!cancel.props.disabled);
    await act(async()=>cancel.props.onClick());
    assert.equal(pauses[0][1],"resume");
  }finally{
    if(view)act(()=>view.unmount());
    global.window=original;
  }
});
