const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");
const {platformRegistry,createInitialPlatformStates}=load("ui/registry.ts");
const {PlatformCard}=load("ui/PlatformCard.tsx");
const {ZhidaoActivityPanel}=load("components/ZhidaoActivityPanel.tsx");

const buttons=view=>view.root.findAllByType("button");
const words=node=>typeof node==="string"?node:
  Array.isArray(node)?node.map(words).join(""):node?.children?words(node.children):"";

test("registry retains active platform metadata without unused capability guesses",()=>{
  assert.deepEqual(platformRegistry.map(item=>item.id),["zhidao","yuketang","xuexitong","ucampus"]);
  for(const item of platformRegistry)assert.deepEqual(Object.keys(item).sort(),["color","id","mark","name"]);
  const states=createInitialPlatformStates();
  for(const item of platformRegistry){
    assert.equal(states[item.id].status,"not_connected");
    assert.deepEqual(states[item.id].courses,[]);
  }
});

test("both actually used PlatformCard variants retain their controls",()=>{
  const definition=platformRegistry[0];
  const state={platform:"zhidao",status:"connected",message:"",courses:[]};
  let view,entered=0,synced=0,login=0;
  const common={definition,state,desktop:true,busy:false,
    onSync:()=>synced++,onToggleLogin:()=>login++,onEnterCourses:()=>entered++};
  try{
    act(()=>{view=create(React.createElement(PlatformCard,{...common,expanded:false}))});
    let btns=buttons(view);
    const enter=btns.find(b=>words(b).includes("进入课程"));
    const sync=btns.find(b=>b.props["aria-label"]==="知到同步课程");
    assert.ok(enter);assert.ok(sync);
    act(()=>{enter.props.onClick();sync.props.onClick()});
    assert.equal(entered,1);assert.equal(synced,1);
    act(()=>view.update(React.createElement(PlatformCard,{...common,variant:"account",expanded:true},"账号内容")));
    btns=buttons(view);
    assert.equal(btns.length,1);
    assert.match(words(view.toJSON()),/账号内容/);
    assert.doesNotMatch(words(view.toJSON()),/进入课程/);
    act(()=>btns[0].props.onClick());
    assert.equal(login,1);
  }finally{if(view)act(()=>view.unmount());}
});

test("course diagnostics are inline, scoped, capped at 20, and have no duplicate accordion",()=>{
  const entries=Array.from({length:21},(_,i)=>({id:String(i),at:"2026-11-17T09:00:00Z",
    platform:"知到",action:"日志-"+i,detail:"测试记录",result:"info"}));
  let view;
  try{
    act(()=>{view=create(React.createElement(ZhidaoActivityPanel,{events:entries}))});
    assert.equal(view.root.findAllByType("article").length,20);
    assert.equal(view.root.findAllByType("button").length,0);
    assert.equal(view.root.findAllByProps({className:"sf-inline-activity"}).length,1);
    act(()=>view.update(React.createElement(ZhidaoActivityPanel,{events:[]})));
    assert.match(words(view.toJSON()),/当前暂无运行日志/);
  }finally{if(view)act(()=>view.unmount());}
});
