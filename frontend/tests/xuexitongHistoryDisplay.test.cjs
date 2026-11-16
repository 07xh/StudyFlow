const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

test("Xuexitong read-only historical task display does not pretend a restored runner exists",async()=>{
  const course={platform:"xuexitong",course_id:"9:8:7",title:"离线验收课程",progress_percent:null};
  const calls=[];
  const {XuexitongHeartbeatPanel}=load("components/XuexitongHeartbeatPanel.tsx",{
    "../bridge":{
      request:async message=>{
        calls.push(message.operation);
        if(message.operation==="xuexitong.settings.get")
          return {playback_speed:1.5,concurrency:3,skip_completed:true,verify_after_run:true};
        if(message.operation==="xuexitong.heartbeat.logs")return {ok:true,events:[]};
        if(message.operation==="xuexitong.heartbeat.status")return {
          ok:true,running:false,paused:false,run_id:"",course_key:"9:8:7",
          config:{speed:1,jobs:2,instant_complete:true,randomize_interval:false},
          task_count:1,heartbeats:{sent:0,server_confirmed:0},
          queue_controls:{pause:false,resume:false,stop:false},
          tasks:[{task_id:"historic",run_id:"past-run",course_key:"9:8:7",
            chapter:"第一节",title:"历史任务",state:"interrupted",
            playing_time:7,duration:60,speed:1.5,last_send_state:"",
            sent_count:0,server_confirmed:false,server_play_time:0,
            end_reason:"",confirmed:false,resumable:true}]
        };
        throw Error("Unexpected IPC "+message.operation);
      },
      friendlyBridgeError:e=>String(e),
    }
  });
  let view;
  try{
    await act(async()=>{view=create(React.createElement(XuexitongHeartbeatPanel,{course,desktop:true}));});
    const output=JSON.stringify(view.toJSON());
    assert.match(output,/历史记录（未运行）/);
    assert.match(output,/历史任务/);
    assert.doesNotMatch(output,/1x \/ 2 并发/,"server fallback must not display as current run");
    assert.ok(calls.includes("xuexitong.heartbeat.status"));
    assert.ok(calls.includes("xuexitong.heartbeat.logs"));
    const buttons=view.root.findAllByType("button");
    for(const label of ["暂停","继续","停止"]){
      assert.equal(buttons.find(b=>b.props.children===label)?.props.disabled,true,
        "inactive old run must not allow "+label);
    }
  }finally{
    if(view)await act(async()=>{view.unmount();});
  }
});
