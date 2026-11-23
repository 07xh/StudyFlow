const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const COURSE="a".repeat(64);
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
const task=(id,chapter,state)=>({
  knowledge_id:String(id),name:"知识点"+id,theme:chapter===1?"绪论":"第一章",
  chapter_index:chapter,mastery:state==="done"?100:50,state,rounds:1,
  reason:state==="done"?"服务器已达标":"暂未达标",
});
const completed={
  course_key:COURSE,state:"completed",message:"本次章节已全部处理",total:4,
  processed:4,done:2,skipped:2,chapter_total:2,
  selected_chapters:[{index:1,name:"绪论",knowledge_count:2},
    {index:2,name:"第一章",knowledge_count:2}],
  tasks:[task(1001,1,"done"),task(1002,1,"skipped"),
    task(1003,2,"done"),task(1004,2,"skipped")],
};

async function render(snapshot){
  const original=global.window;
  global.window={setInterval:()=>12,clearInterval:()=>{},
    setTimeout:()=>13,clearTimeout:()=>{}};
  const mocks={
    masteryAutoStatus:async()=>snapshot,
    masteryAutoStart:async()=>snapshot,
    masteryAutoControl:async()=>snapshot,
    masteryCatalog:async()=>({knowledge:[
      {chapter_index:1,theme:"绪论",knowledge_id:"1001"},
      {chapter_index:2,theme:"第一章",knowledge_id:"1003"},
    ]}),
    questionBankList:async()=>({providers:[],tokens:[]}),
    friendlyBridgeError:error=>String(error?.message||error),
  };
  const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":mocks});
  let view;
  await act(async()=>{
    view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));
  });
  return {view,restore:async()=>{
    await act(async()=>view.unmount());
    global.window=original;
  }};
}
function findBar(view,label){
  return view.root.findAllByProps({role:"progressbar"})
    .find(node=>node.props["aria-label"]===label);
}

test("a completed scan with skipped points is 100% processed but 50% server-verified",async()=>{
  const {view,restore}=await render(completed);
  try{
    const processed=findBar(view,"已处理知识点进度");
    const verified=findBar(view,"服务器确认达标知识点进度");
    assert.ok(processed&&verified);
    assert.equal(processed.props["aria-valuenow"],100);
    assert.equal(verified.props["aria-valuenow"],50);
    assert.equal(processed.findByType("span").props.style.width,"100%");
    assert.equal(verified.findByType("span").props.style.width,"50%");
    const visible=textOf(view.root);
    assert.match(visible,/任务已处理（含未达标项）/);
    assert.match(visible,/服务器确认达标/);
    assert.match(visible,/处理完毕不等于全部达标/);
    assert.match(visible,/仍有 2 个知识点未确认达标/);
    const firstChapterProcessed=findBar(view,"第1章任务已处理");
    const firstChapterVerified=findBar(view,"第1章服务器确认达标");
    assert.equal(firstChapterProcessed.props["aria-valuenow"],100);
    assert.equal(firstChapterVerified.props["aria-valuenow"],50);
    assert.match(visible,/服务器确认达标 1\/2/);
  }finally{await restore();}
});

test("all server-confirmed points yield both 100% bars without incomplete notice",async()=>{
  const tasks=completed.tasks.map(t=>({...t,state:"done",mastery:100}));
  const {view,restore}=await render({...completed,done:4,skipped:0,tasks});
  try{
    assert.equal(findBar(view,"已处理知识点进度").props["aria-valuenow"],100);
    assert.equal(findBar(view,"服务器确认达标知识点进度").props["aria-valuenow"],100);
    assert.doesNotMatch(textOf(view.root),/处理完毕不等于全部达标/);
  }finally{await restore();}
});

test("idle with zero tasks does not invent progress or display completed claims",async()=>{
  const idle={state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[]};
  const {view,restore}=await render(idle);
  try{
    assert.equal(findBar(view,"已处理知识点进度").props["aria-valuenow"],0);
    assert.equal(findBar(view,"服务器确认达标知识点进度").props["aria-valuenow"],0);
    assert.doesNotMatch(textOf(view.root),/处理完毕不等于全部达标/);
  }finally{await restore();}
});
