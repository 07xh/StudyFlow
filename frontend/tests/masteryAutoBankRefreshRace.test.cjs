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

const specificTokens=[
  {id:"1".repeat(32),provider_id:"yanxi",label:"第一条 Token",active:true},
  {id:"2".repeat(32),provider_id:"yanxi",label:"第二条 Token",active:false},
];
const tokenState=tokens=>({
  providers:[{id:"yanxi",name:"共享题库",description:""}],
  tokens,
});

test("removing explicitly selected token never silently switches to automatic rotation",async()=>{
  let tokens=specificTokens;
  await withPanel(async()=>tokenState(tokens),async({view,refresh})=>{
    const start=()=>view.root.findAllByType("button")
      .find(x=>x.props.className==="sf-mastery-auto-start");
    const tokenSelect=()=>view.root.findAllByType("select")
      .find(x=>x.props.value===""||x.props.value===specificTokens[0].id);
    assert.ok(tokenSelect(),"token selection should be present");
    await act(async()=>tokenSelect().props.onChange({
      target:{value:specificTokens[0].id},
    }));
    assert.equal(start().props.disabled,false);
    tokens=[specificTokens[1]];
    await act(async()=>refresh().props.onClick());
    assert.equal(tokenSelect().props.value,specificTokens[0].id,
      "removed explicit selection must remain visible and unresolved");
    assert.match(textOf(view.root),/原指定 Token 不再可用/);
    assert.equal(start().props.disabled,true,
      "never launch using a different paid token without an explicit choice");
    const stale=tokenSelect().findAllByType("option")
      .find(x=>x.props.value===specificTokens[0].id);
    assert.equal(stale.props.disabled,true);
    await act(async()=>tokenSelect().props.onChange({target:{value:""}}));
    assert.equal(start().props.disabled,false,
      "user explicitly switching to automatic mode restores launch");
  });
});

test("token list refresh failure blocks external start until a newer verified read",async()=>{
  let calls=0;
  await withPanel(async()=>{
    calls++;
    if(calls===2)throw new Error("SHARED_VAULT_READ_FAILURE");
    return tokenState(specificTokens);
  },async({view,refresh})=>{
    const start=()=>view.root.findAllByType("button")
      .find(x=>x.props.className==="sf-mastery-auto-start");
    assert.equal(start().props.disabled,false);
    await act(async()=>refresh().props.onClick());
    assert.match(textOf(view.root),/SHARED_VAULT_READ_FAILURE/);
    assert.equal(start().props.disabled,true,"cached tokens are not trusted after a read failure");
    await act(async()=>refresh().props.onClick());
    assert.doesNotMatch(textOf(view.root),/SHARED_VAULT_READ_FAILURE/);
    assert.equal(start().props.disabled,false);
    assert.equal(calls,3);
  });
});
