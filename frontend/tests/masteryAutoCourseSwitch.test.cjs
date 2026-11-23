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


test("A to B to A creates a new visit; the first A response cannot replace the second",async()=>{
  const original=global.window;
  global.window={setInterval:()=>11,clearInterval:()=>{},
    setTimeout:()=>12,clearTimeout:()=>{}};
  const firstStatus=deferred(),firstCatalog=deferred();
  const secondStatus=deferred(),secondCatalog=deferred();
  let aStatusCalls=0,aCatalogCalls=0;
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async(course)=>course===B?snapshot(B,"B 状态"):
        (++aStatusCalls===1?firstStatus.promise:secondStatus.promise),
      masteryAutoStart:async()=>snapshot(A,"已启动"),
      masteryAutoControl:async()=>snapshot(A,"已停止"),
      masteryCatalog:async(course)=>course===B?
        {knowledge:[{chapter_index:1,theme:"B 目录",knowledge_id:"2001"}]}:
        (++aCatalogCalls===1?firstCatalog.promise:secondCatalog.promise),
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:error=>String(error?.message||error),
    }});
    await act(async()=>view=create(React.createElement(MasteryAutoPanel,{courseKey:A,desktop:true})));
    await act(async()=>view.update(React.createElement(MasteryAutoPanel,{courseKey:B,desktop:true})));
    await act(async()=>view.update(React.createElement(MasteryAutoPanel,{courseKey:A,desktop:true})));
    assert.equal(aStatusCalls,2,"second visit must issue its own status read");
    assert.equal(aCatalogCalls,2,"second visit must issue its own catalog read");

    await act(async()=>{
      firstStatus.resolve(snapshot(A,"第一次 A 的迟到状态"));
      firstCatalog.resolve({knowledge:[{chapter_index:1,theme:"旧 A 章节",knowledge_id:"1001"}]});
    });
    let visible=textOf(view.root);
    assert.doesNotMatch(visible,/第一次 A 的迟到状态|旧 A 章节/);
    const start=()=>view.root.findAllByType("button")
      .find(button=>textOf(button).includes("开始执行"));
    assert.equal(start()?.props.disabled,true,
      "first visit's stale catalog must not enable second visit");

    await act(async()=>{
      secondStatus.resolve(snapshot(A,"第二次 A 的当前状态"));
      secondCatalog.resolve({knowledge:[{chapter_index:1,theme:"新 A 章节",knowledge_id:"1002"}]});
    });
    await act(async()=>view.root.findAllByType("button")
      .find(button=>textOf(button)==="只做一章").props.onClick());
    visible=textOf(view.root);
    assert.match(visible,/第二次 A 的当前状态|新 A 章节/);
    assert.doesNotMatch(visible,/旧 A 章节|第一次 A 的迟到状态/);
    assert.equal(start()?.props.disabled,false);
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
});


test("a delayed idle poll cannot replace a completed Start result",async()=>{
  const original=global.window;
  global.window={setInterval:()=>11,clearInterval:()=>{},
    setTimeout:()=>12,clearTimeout:()=>{}};
  const pending=deferred();
  let reads=0;
  const running={...snapshot(A,"新任务运行中"),state:"running",total:1,processed:0,
    tasks:[{knowledge_id:"1001",name:"第一知识点",theme:"第一章",
      mastery:20,state:"working",rounds:1,reason:"读取中"}]};
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async()=>++reads===1?snapshot(A,"首次状态已核验"):pending.promise,
      masteryAutoStart:async()=>running,
      masteryAutoControl:async()=>running,
      masteryCatalog:async()=>({knowledge:[{chapter_index:1,theme:"第一章",knowledge_id:"1001"}]}),
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:error=>String(error?.message||error),
    }});
    await act(async()=>view=create(React.createElement(MasteryAutoPanel,{courseKey:A,desktop:true})));
    const start=()=>view.root.findAllByType("button").find(x=>x.props.className==="sf-mastery-auto-start");
    assert.equal(start()?.props.disabled,false,"first verified idle snapshot enables launch");
    const tick=()=>view.root.findAllByType("button").find(x=>textOf(x)==="刷新");
    await act(async()=>tick().props.onClick());
    assert.equal(reads,2,"a second status read should be pending before Start");
    await act(async()=>start().props.onClick());
    assert.match(textOf(view.root),/新任务运行中/);
    assert.equal(start()?.props.disabled,true);

    await act(async()=>pending.resolve(snapshot(A,"过期的未开始状态")));
    const visible=textOf(view.root);
    assert.match(visible,/新任务运行中/);
    assert.doesNotMatch(visible,/过期的未开始状态/);
    assert.equal(start()?.props.disabled,true);
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
});

test("a poll started before Pause cannot overwrite the paused control response",async()=>{
  const original=global.window;
  const callbacks=[];
  global.window={setInterval:fn=>{callbacks.push(fn);return 11;},clearInterval:()=>{},
    setTimeout:()=>12,clearTimeout:()=>{}};
  const pending=deferred();
  let calls=0;
  const running={...snapshot(A,"旧运行中"),state:"running",total:1,processed:0};
  const paused={...running,state:"paused",message:"已安全暂停"};
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async()=>++calls===1?running:pending.promise,
      masteryAutoStart:async()=>running,
      masteryAutoControl:async()=>paused,
      masteryCatalog:async()=>({knowledge:[{chapter_index:1,theme:"第一章",knowledge_id:"1001"}]}),
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:error=>String(error?.message||error),
    }});
    await act(async()=>view=create(React.createElement(MasteryAutoPanel,{courseKey:A,desktop:true})));
    assert.match(textOf(view.root),/旧运行中/);
    await act(async()=>callbacks[0]());
    const pause=view.root.findAllByType("button")
      .find(x=>textOf(x).includes("完成当前项后暂停"));
    assert.ok(pause&&!pause.props.disabled);
    await act(async()=>pause.props.onClick());
    assert.match(textOf(view.root),/已安全暂停/);
    await act(async()=>pending.resolve(running));
    const visible=textOf(view.root);
    assert.match(visible,/已安全暂停/);
    assert.doesNotMatch(visible,/旧运行中/);
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
});


test("switching to a course whose catalog arrives first must wait for its own status",async()=>{
  const original=global.window;
  global.window={setInterval:()=>11,clearInterval:()=>{},
    setTimeout:()=>12,clearTimeout:()=>{}};
  const statusB=deferred();
  const starts=[];
  let view;
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async(course)=>course===A?snapshot(A,"A 已核验"):statusB.promise,
      masteryAutoStart:async(course)=>{
        starts.push(course);return snapshot(course,"已启动");
      },
      masteryAutoControl:async()=>snapshot(B,"已停止"),
      masteryCatalog:async(course)=>({knowledge:[{
        chapter_index:1,theme:course===A?"A 章节":"B 章节",knowledge_id:"1001",
      }]}),
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:error=>String(error?.message||error),
    }});
    await act(async()=>view=create(React.createElement(MasteryAutoPanel,{courseKey:A,desktop:true})));
    const start=()=>view.root.findAllByType("button")
      .find(x=>x.props.className==="sf-mastery-auto-start");
    assert.equal(start().props.disabled,false);
    await act(async()=>view.update(React.createElement(MasteryAutoPanel,{courseKey:B,desktop:true})));
    assert.match(textOf(view.root),/正在核验后台状态/);
    assert.equal(start().props.disabled,true,
      "B catalog is ready, but B's worker status has never been confirmed");
    assert.equal(starts.length,0);
    await act(async()=>statusB.resolve(snapshot(B,"B 已确认未运行")));
    assert.doesNotMatch(textOf(view.root),/正在核验后台状态/);
    assert.equal(start().props.disabled,false);
    await act(async()=>start().props.onClick());
    assert.deepEqual(starts,[B]);
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
});
