const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const COURSE="a".repeat(64);
const EMPTY={state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[]};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
const banks=(id,name)=>({
  providers:[{id,name,description:""}],
  tokens:[{id:id+"-token",provider_id:id,label:name+" Token",active:true}],
});

async function withPanel(readBanks,check){
  const original=global.window;
  global.window={setInterval:()=>10,clearInterval:()=>{},
    setTimeout:()=>11,clearTimeout:()=>{}};
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async()=>EMPTY,
      masteryAutoStart:async()=>EMPTY,
      masteryAutoControl:async()=>EMPTY,
      masteryCatalog:async()=>({knowledge:[{chapter_index:1,theme:"绪论",knowledge_id:"1001"}]}),
      questionBankList:readBanks,
      friendlyBridgeError:error=>String(error?.message||error),
    }});
    await act(async()=>{
      view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));
    });
    const external=view.root.findAllByType("input")
      .find(x=>x.props.type==="checkbox");
    await act(async()=>external.props.onChange({target:{checked:true}}));
    const refresh=()=>view.root.findAllByType("button")
      .find(x=>textOf(x).includes("刷新 Token"));
    assert.ok(refresh(),"shared-bank refresh action should exist");
    await check({view,refresh});
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
}

test("newer token refresh wins when initial read returns late",async()=>{
  const old=deferred(),newer=deferred();
  let calls=0;
  await withPanel(()=>++calls===1?old.promise:newer.promise,async({view,refresh})=>{
    await act(async()=>refresh().props.onClick());
    assert.equal(calls,2);
    await act(async()=>newer.resolve(banks("current","新题库")));
    assert.match(textOf(view.root),/新题库 Token/);
    assert.doesNotMatch(textOf(view.root),/旧题库 Token/);
    await act(async()=>old.resolve(banks("old","旧题库")));
    const visible=textOf(view.root);
    assert.match(visible,/新题库 Token/);
    assert.doesNotMatch(visible,/旧题库 Token/);
    const provider=view.root.findAllByType("select")
      .find(s=>s.props.value==="current");
    assert.ok(provider,"old response must not reset the chosen provider");
  });
});

test("outdated failed token read cannot resurrect an error after successful refresh",async()=>{
  const old=deferred();
  let calls=0;
  await withPanel(()=>++calls===1?old.promise:Promise.resolve(banks("current","新题库")),
    async({view,refresh})=>{
      await act(async()=>refresh().props.onClick());
      assert.match(textOf(view.root),/新题库 Token/);
      await act(async()=>old.reject(new Error("OLD_TOKEN_FAILURE")));
      assert.doesNotMatch(textOf(view.root),/OLD_TOKEN_FAILURE/);
      assert.match(textOf(view.root),/新题库 Token/);
    });
});

test("a superseded success cannot clear the latest token refresh error",async()=>{
  const old=deferred(),newer=deferred();
  let calls=0;
  await withPanel(()=>++calls===1?old.promise:newer.promise,
    async({view,refresh})=>{
      await act(async()=>refresh().props.onClick());
      await act(async()=>newer.reject(new Error("LATEST_TOKEN_FAILURE")));
      assert.match(textOf(view.root),/LATEST_TOKEN_FAILURE/);
      await act(async()=>old.resolve(banks("old","过期题库")));
      assert.match(textOf(view.root),/LATEST_TOKEN_FAILURE/);
      assert.doesNotMatch(textOf(view.root),/过期题库 Token/);
    });
});
