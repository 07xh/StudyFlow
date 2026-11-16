const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const course={platform:"xuexitong",course_id:"10:20:30",title:"进度测试",progress_percent:null};
const task=(id,state,seconds,confirmed)=>({
  task_id:id,run_id:"abc",course_key:course.course_id,chapter_id:id,
  chapter:"第"+id+"章",title:"任务"+id,state,playing_time:seconds,duration:600,
  speed:1,last_send_state:state==="running"?"reported":"",sent_count:1,
  server_confirmed:confirmed,server_play_time:confirmed?600:0,
  end_reason:"",confirmed,resumable:false
});
const status={
  ok:true,running:true,paused:false,run_id:"abc",course_key:course.course_id,
  config:{speed:1,jobs:3,instant_complete:false,randomize_interval:true},
  task_count:2,tasks:[task("1","running",240,false),task("2","pending",0,true)],
  queue:{total_chapters:2,active_chapters:1,paused_chapters:0,
    queued_chapters:1,pending_tasks:1,running_tasks:1},
  heartbeats:{sent:1,server_confirmed:1},
  queue_controls:{pause:true,resume:false,stop:true}
};

test("runtime shows real active and queued counts without equating local time to completion",async()=>{
  const {XuexitongHeartbeatPanel}=load("components/XuexitongHeartbeatPanel.tsx",{
    "../bridge":{
      friendlyBridgeError:error=>String(error),
      request:async ({operation})=>{
        if(operation==="xuexitong.settings.get")return {
          playback_speed:1,concurrency:3,skip_completed:true,verify_after_run:true
        };
        if(operation==="xuexitong.heartbeat.logs")return {ok:true,events:[]};
        if(operation==="xuexitong.heartbeat.status")return status;
        throw Error("Unexpected IPC "+operation);
      }
    }
  });
  let view;
  try{
    await act(async()=>{view=create(React.createElement(XuexitongHeartbeatPanel,{course,desktop:true}));});
    const json=JSON.stringify(view.toJSON());
    assert.match(json,/正在运行章节/);
    assert.match(json,/排队章节/);
    assert.match(json,/排队任务/);
    assert.match(json,/本地计时（非平台进度）/);
    assert.match(json,/学习通返回状态/);
    assert.match(json,/未确认完成/);
    assert.match(json,/已确认完成/);
    assert.match(json,/排队中/);
    const bars=view.root.findAllByProps({role:"progressbar"});
    assert.equal(bars.length,2);
    assert.equal(bars[0].props["aria-valuenow"],40);
    assert.equal(bars[1].props["aria-valuenow"],0);
    const check=view.root.findAllByType("input").find(item=>item.props.type==="checkbox");
    assert.equal(check.props.checked,false,"instant-complete opt-in must default unchecked");
    const metrics=view.root.findByProps({className:"sf-stat-grid"});
    assert.match(JSON.stringify(metrics.toJSON()),/1 \/ 2/);
  }finally{
    if(view)await act(async()=>{view.unmount();});
  }
});
