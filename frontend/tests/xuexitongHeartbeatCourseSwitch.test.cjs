const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const course=id=>({platform:"xuexitong",course_id:id,title:"课程 "+id,progress_percent:null});
const snapshot=(id,task)=>({
  ok:true,running:false,paused:false,run_id:"",course_key:id,
  config:{speed:1,jobs:2,instant_complete:false,randomize_interval:false},
  task_count:1,heartbeats:{sent:0,server_confirmed:0},
  queue_controls:{pause:false,resume:false,stop:false},
  tasks:[{task_id:task,run_id:"past",course_key:id,chapter:"第1章",title:task,
    state:"interrupted",playing_time:0,duration:60,speed:1,last_send_state:"",
    sent_count:0,server_confirmed:false,server_play_time:0,end_reason:"",
    confirmed:false,resumable:true}]
});

test("switching Xuexitong courses starts a new status request while old one is pending",async()=>{
  const requests=[];
  let resolveOld;
  const oldPromise=new Promise(resolve=>{resolveOld=resolve;});
  const {XuexitongHeartbeatPanel}=load("components/XuexitongHeartbeatPanel.tsx",{
    "../bridge":{
      request:async message=>{
        requests.push({operation:message.operation,course:message.course_id});
        if(message.operation==="xuexitong.settings.get")return {
          playback_speed:1,concurrency:2,skip_completed:true,verify_after_run:true
        };
        if(message.operation==="xuexitong.heartbeat.logs")return {ok:true,events:[]};
        if(message.operation==="xuexitong.heartbeat.status"){
          if(message.course_id==="10:20:30")return oldPromise;
          if(message.course_id==="40:50:60")return snapshot("40:50:60","新课程任务");
        }
        throw Error("Unexpected operation: "+message.operation);
      },
      friendlyBridgeError:e=>String(e),
    }
  });
  let view;
  try{
    await act(async()=>{
      view=create(React.createElement(XuexitongHeartbeatPanel,{course:course("10:20:30"),desktop:true}));
    });
    assert.equal(requests.filter(r=>r.operation==="xuexitong.heartbeat.status"&&r.course==="10:20:30").length,1);
    await act(async()=>{
      view.update(React.createElement(XuexitongHeartbeatPanel,{course:course("40:50:60"),desktop:true}));
    });
    assert.ok(requests.some(r=>r.operation==="xuexitong.heartbeat.status"&&r.course==="40:50:60"),
      "the new course must not be blocked by the old unresolved request");
    assert.match(JSON.stringify(view.toJSON()),/新课程任务/);

    await act(async()=>{resolveOld(snapshot("10:20:30","旧课程迟到的结果"));});
    const actual=JSON.stringify(view.toJSON());
    assert.match(actual,/新课程任务/);
    assert.doesNotMatch(actual,/旧课程迟到的结果/);
  }finally{
    if(view)await act(async()=>{view.unmount();});
  }
});

test("Xuexitong heartbeat UI is bound to the persistent bridge, not an embedded player",()=>{
  const fs=require("node:fs"),path=require("node:path");
  const root=path.join(__dirname,"..","src");
  const component=fs.readFileSync(path.join(root,"components","XuexitongHeartbeatPanel.tsx"),"utf8");
  const bridge=fs.readFileSync(path.join(root,"bridge.ts"),"utf8");
  assert.match(component,/courseRevision\.current\+\+/);
  assert.match(component,/refreshInFlight\.current\.has\(revision\)/);
  for(const action of ["start","pause","resume","stop","status","logs"]){
    assert.match(component,new RegExp('operation:"xuexitong\\.heartbeat\\.'+action+'"'));
    assert.ok(bridge.includes('operation:"xuexitong.heartbeat.'+action+'"'));
  }
  assert.doesNotMatch(component,/WebView2|zhidao_player_start/);
});
