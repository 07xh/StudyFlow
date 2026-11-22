const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const COURSE="a".repeat(64);
const ID="b".repeat(32);
const empty={state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[]};
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");

test("mastery auto can explicitly use selected shared-bank token without exposing its secret",async()=>{
  const original=global.window;
  global.window={setInterval:()=>12,clearInterval:()=>{},
                 setTimeout:()=>13,clearTimeout:()=>{}};
  const calls=[];
  const mocks={
    masteryAutoStatus:async()=>empty,
    masteryAutoStart:async(course,options)=>{calls.push([course,options]);return empty;},
    masteryAutoControl:async()=>empty,
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
    assert.match(textOf(view.root),/用于自动查询的 Token/);
    assert.match(textOf(view.root),/第一个 Token/);
    const start=view.root.findAllByType("button").find(b=>textOf(b).includes("开始全部章节"));
    assert.ok(start&&!start.props.disabled);
    await act(async()=>start.props.onClick());
    assert.equal(calls.length,1);
    assert.equal(calls[0][0],COURSE);
    assert.equal(calls[0][1].use_external_bank,true);
    assert.equal(calls[0][1].external_provider_id,"yanxi");
    assert.equal(calls[0][1].external_token_id,ID);
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
      masteryAutoControl:async()=>empty,questionBankList:async()=>({
        providers:[{id:"yanxi",name:"言溪题库",description:""}],tokens:[]}),
      friendlyBridgeError:()=> "失败",
    }});
    await act(async()=>{view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));});
    const checkbox=view.root.findAllByType("input").find(input=>input.props.type==="checkbox");
    await act(async()=>checkbox.props.onChange({target:{checked:true}}));
    const button=view.root.findAllByType("button").find(b=>textOf(b).includes("开始全部章节"));
    assert.ok(button.props.disabled);
    assert.match(textOf(view.root),/请先在全局设置/);
  }finally{
    if(view)act(()=>view.unmount());
    global.window=original;
  }
});
