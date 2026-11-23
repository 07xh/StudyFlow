const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const COURSE="a".repeat(64);
const task={knowledge_id:"1001",name:"知识点一",theme:"第一章",
  mastery:30,state:"working",rounds:1,reason:"正在读取本轮题目"};
const snapshot=(state,message)=>({
  course_key:COURSE,state,message,run_id:"r1",
  total:1,processed:0,done:0,skipped:0,
  current:state==="running"?{knowledge_id:"1001",name:"知识点一",theme:"第一章"}:null,
  tasks:[task],
});
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

async function setup(readStatus){
  const original=global.window;
  const tick=[];
  global.window={
    setInterval:fn=>{tick.push(fn);return 17;},
    clearInterval:()=>{},setTimeout:()=>19,clearTimeout:()=>{},
  };
  let view;
  const mocks={
    masteryAutoStatus:readStatus,
    masteryAutoStart:async()=>{throw Error("start must not be used");},
    masteryAutoControl:async()=>{throw Error("control must not be used");},
    masteryCatalog:async()=>({knowledge:[{chapter_index:1,theme:"第一章",knowledge_id:"1001"}]}),
    questionBankList:async()=>({providers:[],tokens:[]}),
    friendlyBridgeError:error=>String(error?.message||error),
  };
  const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":mocks});
  await act(async()=>{
    view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));
  });
  const button=label=>view.root.findAllByType("button")
    .find(b=>textOf(b)===label);
  const cleanup=async()=>{
    await act(async()=>view.unmount());
    global.window=original;
  };
  return {view,tick,button,cleanup};
}

test("failed status read retains last evidence but disables controls until recovery",async()=>{
  let calls=0;
  const {view,tick,button,cleanup}=await setup(async()=>{
    calls+=1;
    if(calls===2)throw new Error("READ_FAILED_ONCE");
    return snapshot("running","最新运行中");
  });
  try{
    assert.match(textOf(view.root),/最新运行中/);
    assert.equal(button("完成当前项后暂停").props.disabled,false);
    await act(async()=>{tick[0]();});
    const unhealthy=textOf(view.root);
    assert.match(unhealthy,/状态待确认/);
    assert.match(unhealthy,/READ_FAILED_ONCE/);
    assert.match(unhealthy,/上次确认的执行信息/);
    assert.equal(button("完成当前项后暂停").props.disabled,true);
    assert.equal(button("停止").props.disabled,true);
    assert.equal(button("刷新").props.disabled,false);
    await act(async()=>button("刷新").props.onClick());
    const healthy=textOf(view.root);
    assert.doesNotMatch(healthy,/READ_FAILED_ONCE|状态待确认/);
    assert.match(healthy,/后台运行中/);
    assert.equal(button("完成当前项后暂停").props.disabled,false);
  }finally{await cleanup();}
});

test("manual refresh bypasses a hung poll and rejects old idle response",async()=>{
  const old=deferred();
  let calls=0;
  const {view,button,cleanup}=await setup(async()=>{
    calls+=1;
    return calls===1?old.promise:snapshot("running","新刷新已确认在运行");
  });
  try{
    assert.equal(calls,1);
    await act(async()=>button("刷新").props.onClick());
    assert.equal(calls,2,"manual refresh must not silently no-op while old poll hangs");
    let visible=textOf(view.root);
    assert.match(visible,/新刷新已确认在运行/);
    assert.equal(button("完成当前项后暂停").props.disabled,false);
    await act(async()=>old.resolve(snapshot("idle","迟到的未开始状态")));
    visible=textOf(view.root);
    assert.match(visible,/新刷新已确认在运行/);
    assert.doesNotMatch(visible,/迟到的未开始状态/);
    assert.equal(button("完成当前项后暂停").props.disabled,false);
  }finally{await cleanup();}
});

test("initial status failure prevents starting until a successful authenticated read",async()=>{
  let calls=0;
  const {view,button,cleanup}=await setup(async()=>{
    calls+=1;
    if(calls===1)throw new Error("STATUS_OFFLINE");
    return snapshot("idle","已确认未运行");
  });
  try{
    assert.match(textOf(view.root),/STATUS_OFFLINE/);
    const start=view.root.findAllByType("button").find(b=>b.props.className==="sf-mastery-auto-start");
    assert.equal(start.props.disabled,true);
    await act(async()=>button("刷新").props.onClick());
    assert.doesNotMatch(textOf(view.root),/STATUS_OFFLINE|状态待确认/);
    assert.equal(start.props.disabled,false);
  }finally{await cleanup();}
});
