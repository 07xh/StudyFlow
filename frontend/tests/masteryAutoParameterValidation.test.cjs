const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const COURSE="a".repeat(64);
const empty={state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[]};
const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
async function withPanel(check){
  const original=global.window;
  global.window={setInterval:()=>10,clearInterval:()=>{},
    setTimeout:()=>12,clearTimeout:()=>{}};
  let view;
  const launches=[];
  try{
    const {MasteryAutoPanel}=load("components/MasteryAutoPanel.tsx",{"bridge.ts":{
      masteryAutoStatus:async()=>empty,
      masteryAutoStart:async(course,settings)=>{
        launches.push([course,settings]);return empty;
      },
      masteryAutoControl:async()=>empty,
      masteryCatalog:async()=>({knowledge:[
        {chapter_index:1,theme:"绪论",knowledge_id:"1001"},
        {chapter_index:2,theme:"第一章",knowledge_id:"1002"},
        {chapter_index:3,theme:"第二章",knowledge_id:"1003"},
      ]}),
      questionBankList:async()=>({providers:[],tokens:[]}),
      friendlyBridgeError:error=>String(error?.message||error),
    }});
    await act(async()=>{
      view=create(React.createElement(MasteryAutoPanel,{courseKey:COURSE,desktop:true}));
    });
    const start=()=>view.root.findAllByType("button")
      .find(x=>x.props.className==="sf-mastery-auto-start");
    const input=label=>{
      const entry=view.root.findAllByType("label")
        .find(x=>textOf(x).includes(label));
      assert.ok(entry,"label exists: "+label);
      return entry.findByType("input");
    };
    await check({view,launches,start,input});
  }finally{
    if(view)await act(async()=>view.unmount());
    global.window=original;
  }
}

test("invalid target values never reach IPC, and corrected integer becomes launchable",async()=>{
  await withPanel(async({view,launches,start,input})=>{
    assert.equal(start().props.disabled,false);
    for(const raw of ["0","101","1.5",""]){
      await act(async()=>input("目标分数").props.onChange({target:{value:raw}}));
      assert.equal(start().props.disabled,true,raw+" must not launch");
      assert.match(textOf(view.root),/参数不符合允许范围：目标分数/);
      await act(async()=>start().props.onClick());
      assert.equal(launches.length,0,"invalid config must be blocked inside Start too");
    }
    await act(async()=>input("目标分数").props.onChange({target:{value:"90"}}));
    assert.equal(start().props.disabled,false);
    assert.doesNotMatch(textOf(view.root),/参数不符合允许范围/);
    await act(async()=>start().props.onClick());
    assert.equal(launches.length,1);
    assert.equal(launches[0][0],COURSE);
    assert.equal(launches[0][1].target,90);
  });
});

test("out-of-range runtime, round, and stagnation inputs show explicit validation",async()=>{
  await withPanel(async({view,launches,start,input})=>{
    for(const [label,invalid,expected] of [
      ["每知识点最多轮次","31",/每知识点最多轮次/],
      ["连续不涨分停止","11",/连续不涨分停止/],
      ["最长运行（分钟）","721",/最长运行（分钟）/],
    ]){
      const field=input(label);
      const previous=field.props.value;
      await act(async()=>field.props.onChange({target:{value:invalid}}));
      assert.equal(start().props.disabled,true);
      assert.match(textOf(view.root),/参数不符合允许范围/);
      assert.match(textOf(view.root),expected);
      await act(async()=>input(label).props.onChange({target:{value:String(previous)}}));
      assert.equal(start().props.disabled,false);
    }
    assert.equal(launches.length,0);
  });
});

test("first-N chapter count must be a positive integer no larger than loaded catalog",async()=>{
  await withPanel(async({view,launches,start,input})=>{
    const choose=view.root.findAllByType("button")
      .find(button=>textOf(button)==="前 N 章");
    await act(async()=>choose.props.onClick());
    assert.equal(start().props.disabled,false);
    for(const raw of ["0","4","1.5",""]){
      await act(async()=>input("从第一章开始").props.onChange({target:{value:raw}}));
      assert.equal(start().props.disabled,true);
      assert.match(textOf(view.root),/参数不符合允许范围：前 N 章数量/);
    }
    await act(async()=>input("从第一章开始").props.onChange({target:{value:"2"}}));
    assert.equal(start().props.disabled,false);
    await act(async()=>start().props.onClick());
    assert.equal(launches.length,1);
    assert.equal(launches[0][1].scope_mode,"first_n");
    assert.equal(launches[0][1].chapter_count,2);
  });
});
