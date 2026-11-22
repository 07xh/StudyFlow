const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const A="a".repeat(64),B="b".repeat(64);
const snapshot=(course,name)=>({
  course_key:course,state:"idle",total:0,processed:0,done:0,skipped:0,
  message:name,current:null,tasks:[],
});
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test("switching courses allows B status and chapters while A is pending, then ignores stale A",async()=>{
  const original=global.window;
  global.window={setInterval:()=>11,clearInterval:()=>{},
    setTimeout:()=>12,clearTimeout:()=>{}};
  const oldStatus=deferred(),oldCatalog=deferred(),newCatalog=deferred();
  const starts=[],reads=[];
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async(course)=>{
        reads.push(["status",course]);
        return course===A?oldStatus.promise:snapshot(B,"新课程状态");
      },
      masteryAutoStart:async(course,options)=>{
        starts.push([course,options]);return snapshot(course,"已启动");
      },
      masteryAutoControl:async()=>snapshot(B,"已停止"),
      masteryCatalog:async(course)=>{
        reads.push(["catalog",course]);
        return course===A?oldCatalog.promise:newCatalog.promise;
      },
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:error=>String(error?.message||error),
    }});
    await act(async()=>{
      view=create(React.createElement(MasteryAutoPanel,{courseKey:A,desktop:true}));
    });
    assert.ok(reads.some(x=>x[0]==="status"&&x[1]===A));
    await act(async()=>{
      view.update(React.createElement(MasteryAutoPanel,{courseKey:B,desktop:true}));
    });
    assert.ok(reads.some(x=>x[0]==="status"&&x[1]===B),
      "B must start its status request while A remains unresolved");
    assert.ok(reads.some(x=>x[0]==="catalog"&&x[1]===B),
      "B must request its own chapter catalog");
    const findStart=()=>view.root.findAllByType("button")
      .find(button=>textOf(button).includes("开始执行"));
    assert.ok(findStart()?.props.disabled,
      "never start B without B's own confirmed chapter catalog");

    await act(async()=>{
      oldStatus.resolve(snapshot(A,"旧课程迟到的状态"));
      oldCatalog.resolve({knowledge:[{chapter_index:1,theme:"旧课程第一章",knowledge_id:"1001"}]});
    });
    let visible=textOf(view.root);
    assert.match(visible,/新课程状态/);
    assert.doesNotMatch(visible,/旧课程迟到的状态|旧课程第一章/);
    assert.ok(findStart()?.props.disabled,
      "A's stale catalog must not enable B's Start action");

    await act(async()=>{
      newCatalog.resolve({knowledge:[{chapter_index:2,theme:"新课程第二章",knowledge_id:"2001"}]});
    });
    // In "all chapters" mode the selector is intentionally collapsed; switch
    // to single-chapter mode before asserting its visible option label.
    await act(async()=>view.root.findAllByType("button")
      .find(button=>textOf(button)==="只做一章").props.onClick());
    visible=textOf(view.root);
    assert.match(visible,/新课程第二章/);
    assert.doesNotMatch(visible,/旧课程第一章/);
    assert.equal(findStart()?.props.disabled,false);
    await act(async()=>findStart().props.onClick());
    assert.equal(starts.length,1);
    assert.equal(starts[0][0],B,"Start must be bound to B, never A");
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
});

test("late rejected status and chapter requests from A do not show errors for B",async()=>{
  const original=global.window;
  global.window={setInterval:()=>11,clearInterval:()=>{},
    setTimeout:()=>12,clearTimeout:()=>{}};
  const oldStatus=deferred(),oldCatalog=deferred();
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async(course)=>course===A?oldStatus.promise:snapshot(B,"新课程状态"),
      masteryAutoStart:async()=>snapshot(B,"已启动"),
      masteryAutoControl:async()=>snapshot(B,"已停止"),
      masteryCatalog:async(course)=>course===A?oldCatalog.promise:
        {knowledge:[{chapter_index:1,theme:"B章节",knowledge_id:"2001"}]},
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:error=>String(error?.message||error),
    }});
    await act(async()=>view=create(React.createElement(MasteryAutoPanel,{courseKey:A,desktop:true})));
    await act(async()=>view.update(React.createElement(MasteryAutoPanel,{courseKey:B,desktop:true})));
    await act(async()=>{
      oldStatus.reject(new Error("OLD_STATUS_FAILURE"));
      oldCatalog.reject(new Error("OLD_CATALOG_FAILURE"));
    });
    const visible=textOf(view.root);
    assert.match(visible,/新课程状态|B章节/);
    assert.doesNotMatch(visible,/OLD_STATUS_FAILURE|OLD_CATALOG_FAILURE/);
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
});
