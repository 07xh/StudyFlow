const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const COURSE="a".repeat(64);
const ID="1".repeat(32);
const EMPTY={state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[]};
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const providers=[{id:"yanxi",name:"言溪题库",description:"",supports_check:true}];
const snap=tokens=>({providers,tokens,rotation_modes:{yanxi:"fixed"}});
const token={id:ID,provider_id:"yanxi",label:"Token 001",active:true,validity:"unknown"};

async function withPanels(check,{delayInitialMastery=false}={}){
  const original=global.window;
  const bus=new EventTarget();
  Object.assign(bus,{setInterval:()=>1,clearInterval:()=>{},
    setTimeout:()=>2,clearTimeout:()=>{}});
  global.window=bus;
  let tokens=[],listCalls=0,mastery,settings;
  const old=deferred();
  const seen=[];
  bus.addEventListener("studyflow:question-bank-config-changed",event=>seen.push(event));
  const mocks={
    questionBankList:()=>{listCalls++;
      if(delayInitialMastery&&listCalls===1)return old.promise;
      return Promise.resolve(snap(tokens));
    },
    questionBankImportTokens:async(provider,lines)=>{
      assert.equal(provider,"yanxi");
      assert.equal(lines,"private-example-token");
      tokens=[token];
      return {...snap(tokens),added:1,skipped:0};
    },
    questionBankRemoveToken:async()=>{
      tokens=[];return snap(tokens);
    },
    questionBankSelectToken:async()=>snap(tokens),
    questionBankSetRotation:async()=>snap(tokens),
    questionBankCheckToken:async()=>snap(tokens),
    masteryAutoStatus:async()=>EMPTY,
    masteryAutoStart:async()=>EMPTY,
    masteryAutoControl:async()=>EMPTY,
    masteryCatalog:async()=>({knowledge:[
      {chapter_index:1,theme:"绪论",knowledge_id:"1001"},
    ]}),
    friendlyBridgeError:error=>String(error?.message||error),
  };
  const modal={
    "@tauri-apps/api/core":{invoke:async()=>{}},
    "../ui/SettingsDialog":{SettingsDialog:({open,children})=>open?
      React.createElement("section",{"aria-label":"二级题库管理"},children):null},
    "../ui/ConfirmDialog":{ConfirmDialog:()=>null},
  };
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":mocks});
    const {QuestionBankSettingsPanel}=load("components/QuestionBankSettingsPanel.tsx",{
      "bridge.ts":mocks,...modal,
    });
    await act(async()=>{
      mastery=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));
      settings=create(React.createElement(QuestionBankSettingsPanel,{desktop:true}));
    });
    const button=(view,part)=>view.root.findAllByType("button").find(b=>textOf(b).includes(part));
    const start=()=>mastery.root.findAllByType("button")
      .find(b=>b.props.className==="sf-mastery-auto-start");
    const checkbox=mastery.root.findAllByType("input").find(x=>x.props.type==="checkbox");
    await act(async()=>checkbox.props.onChange({target:{checked:true}}));
    await check({mastery,settings,button,start,seen,old,getListCalls:()=>listCalls});
  }finally{
    if(mastery||settings)await act(async()=>{
      if(mastery)mastery.unmount();
      if(settings)settings.unmount();
    });
    global.window=original;
  }
}

async function importOne({settings,button}){
  await act(async()=>button(settings,"管理").props.onClick());
  const field=settings.root.findByType("textarea");
  await act(async()=>field.props.onChange({target:{value:"private-example-token"}}));
  await act(async()=>button(settings,"批量导入并加密保存").props.onClick());
}

test("a token imported in settings immediately unlocks the open mastery panel without exposing the secret",async()=>{
  await withPanels(async context=>{
    const {settings,button,start,seen}=context;
    assert.equal(start().props.disabled,true,"no configured token yet");
    await importOne(context);
    assert.equal(start().props.disabled,false,"the already-mounted mastery panel should refresh");
    assert.match(textOf(settings.root),/已保存 Token1/);
    assert.match(textOf(context.mastery.root),/Token 001/);
    assert.equal(seen.length,1);
    assert.equal(seen[0].detail,undefined,"event must have no token payload");
    assert.doesNotMatch(textOf(context.mastery.root),/private-example-token/);
    const remove=settings.root.findAllByType("button")
      .find(b=>b.props["aria-label"]==="删除 Token Token 001");
    assert.ok(remove);
    await act(async()=>remove.props.onClick());
    assert.equal(start().props.disabled,true,"removing the last token should block external lookup");
    assert.equal(seen.length,2);
    assert.doesNotMatch(JSON.stringify(seen),/private-example-token/);
  });
});

test("change notification reload supersedes pending initial mastery bank request",async()=>{
  await withPanels(async context=>{
    assert.equal(context.start().props.disabled,true);
    await importOne(context);
    assert.equal(context.start().props.disabled,false);
    await act(async()=>context.old.resolve(snap([])));
    assert.equal(context.start().props.disabled,false,
      "an outdated initial bank read must not revert the imported token");
    assert.match(textOf(context.mastery.root),/Token 001/);
    assert.equal(context.seen.length,1);
  },{delayInitialMastery:true});
});
