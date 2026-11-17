const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const course={course_id:"verified-course",title:"课程",platform:"zhidao",course_type:"shared"};
const initial={speed:"1",allowMinimize:true,autoStart:true,autoNext:true,mode:"official"};
const changed={speed:"2",allowMinimize:false,autoStart:false,autoNext:false,mode:"official"};
const idle={state:"stopped",courseKey:null,runId:null,exitCode:null,event:null,
  positionSeconds:null,durationSeconds:null,visible:false,observedAt:null,message:null};
const words=n=>(n.children??[]).map(c=>typeof c==="string"?c:words(c)).join("");

async function scenario(failRead){
  const before=global.window;
  global.window={setInterval:()=>1,clearInterval:()=>{}};
  let reads=0;
  const starts=[];
  const Panel=load("components/ZhidaoOfficialPlayerPanel.tsx",{
    "@tauri-apps/api/core":{invoke:async (op,args)=>{
      if(op==="zhidao_player_start")starts.push(args);
      return idle;
    }},
    "bridge.ts":{
      request:async query=>{
        assert.equal(query.operation,"zhidao.player.settings.get");
        reads++;
        if(failRead&&reads>=2)throw new Error("settings unavailable");
        return reads===1?initial:changed;
      },
      friendlyBridgeError:e=>String(e),
    }
  }).ZhidaoOfficialPlayerPanel;
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Panel,{
      courses:[course],courseId:course.course_id,desktop:true
    }));});
    const button=view.root.findAllByType("button").find(n=>words(n).includes("打开官方播放器"));
    assert.ok(button);
    assert.equal(button.props.disabled,false);
    await act(async()=>{button.props.onClick();});
    return {starts,reads,rendered:JSON.stringify(view.toJSON())};
  }finally{
    if(view)await act(async()=>view.unmount());
    if(before===undefined)delete global.window;else global.window=before;
  }
}

test("new official player launch reads the saved settings after its panel mounted",async()=>{
  const result=await scenario(false);
  assert.equal(result.reads,2);
  assert.equal(result.starts.length,1);
  assert.equal(result.starts[0].speed,"2");
  assert.equal(result.starts[0].autoNext,false);
  assert.equal(result.starts[0].autoStart,false);
  assert.equal(result.starts[0].allowMinimize,false);
});

test("failed settings refresh blocks launching with stale mounted values",async()=>{
  const result=await scenario(true);
  assert.equal(result.reads,2);
  assert.equal(result.starts.length,0);
  assert.match(result.rendered,/settings unavailable/);
});
