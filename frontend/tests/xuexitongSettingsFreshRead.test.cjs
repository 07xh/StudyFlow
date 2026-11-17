const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const course={course_id:"10:20:30",platform:"xuexitong",title:"本地参数测试",progress_percent:null};
const old={playback_speed:1,concurrency:2,skip_completed:true,verify_after_run:true};
const newer={playback_speed:2,concurrency:4,skip_completed:false,verify_after_run:false};
const textOf=node=>(node.children??[]).map(item=>typeof item==="string"?item:textOf(item)).join("");

async function scenario(editSpeed){
  let settingsReads=0;
  const saves=[],starts=[];
  const Panel=load("components/XuexitongHeartbeatPanel.tsx",{
    "../bridge":{
      request:async request=>{
        if(request.operation==="xuexitong.settings.get"){
          settingsReads++;
          return settingsReads===1?old:newer;
        }
        if(request.operation==="xuexitong.settings.save"){
          saves.push(request.settings);
          return request.settings;
        }
        if(request.operation==="xuexitong.heartbeat.start"){
          starts.push(request);
          return {ok:true,run_id:"local-test-only"};
        }
        if(request.operation==="xuexitong.heartbeat.status")return {
          ok:true,running:false,paused:false,run_id:"",course_key:course.course_id,
          config:{speed:1,jobs:2,instant_complete:false,randomize_interval:false},
          task_count:0,tasks:[],heartbeats:{sent:0,server_confirmed:0},
          queue_controls:{pause:false,resume:false,stop:false}
        };
        if(request.operation==="xuexitong.heartbeat.logs")return {ok:true,events:[]};
        throw new Error("Unexpected operation "+request.operation);
      },
      friendlyBridgeError:e=>String(e)
    }
  }).XuexitongHeartbeatPanel;
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Panel,{course,desktop:true}));});
    if(editSpeed){
      const speed=view.root.findAllByType("input").find(item=>item.props.type==="number");
      assert.ok(speed);
      await act(async()=>{speed.props.onChange({target:{value:"1.5"}});});
    }
    const start=view.root.findAllByType("button").find(item=>textOf(item)==="开始");
    assert.ok(start);
    await act(async()=>{start.props.onClick();});
    return {saves,starts,settingsReads};
  }finally{
    if(view)await act(async()=>view.unmount());
  }
}

test("unchanged course controls use the latest saved global preset without writing stale values",async()=>{
  const result=await scenario(false);
  assert.equal(result.settingsReads,2);
  assert.equal(result.saves.length,0);
  assert.equal(result.starts.length,1);
  assert.equal(result.starts[0].speed,2);
  assert.equal(result.starts[0].jobs,4);
});

test("a manually edited course field overrides only that field, retaining latest unrelated values",async()=>{
  const result=await scenario(true);
  assert.equal(result.settingsReads,2);
  assert.equal(result.saves.length,1);
  assert.deepEqual(result.saves[0],{...newer,playback_speed:1.5});
  assert.equal(result.starts[0].speed,1.5);
  assert.equal(result.starts[0].jobs,4);
});
