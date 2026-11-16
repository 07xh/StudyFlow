const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const root=path.resolve(__dirname,"../..");
const componentPath=path.join(root,"frontend/src/components/XuexitongHeartbeatPanel.tsx");
const cssPath=path.join(root,"frontend/src/components/XuexitongHeartbeatPanel.css");

test("Xuexitong runtime has dedicated, responsive, shell-scoped styles",()=>{
  const component=fs.readFileSync(componentPath,"utf8");
  const css=fs.readFileSync(cssPath,"utf8");
  assert.match(component,/import "\.\/XuexitongHeartbeatPanel\.css"/);
  assert.match(component,/sf-platform-settings-view sf-xxt-runtime/);
  for(const selector of [".sf-settings-row",".sf-actions",".sf-stat-grid",".sf-task-table",".sf-xxt-table-scroll",".sf-xxt-log"]){
    assert.ok(css.includes(".sf-shell .sf-xxt-runtime "+selector),selector+" must be scoped to Xuexitong");
  }
  assert.match(css,/@media\(max-width:850px\)/);
  assert.match(css,/@media\(max-width:620px\)/);
  assert.match(css,/@media\(max-width:460px\)/);
  for(const file of ["XuexitongHeartbeatPanel.tsx","XuexitongHeartbeatPanel.css"]){
    assert.deepEqual(
      fs.readFileSync(path.join(root,"frontend/src/components",file)),
      fs.readFileSync(path.join(root,"integration/frontend",file)),
      file+" integration copy must stay synchronized"
    );
  }
});

test("Xuexitong empty course avoids a blank table and live tasks retain columns",async()=>{
  const course={platform:"xuexitong",course_id:"12:34:56",title:"测试课程",progress_percent:null};
  let withTasks=false;
  const task={task_id:"1",run_id:"run",course_key:course.course_id,chapter:"第一节",
    title:"任务名称",state:"pending",playing_time:0,duration:60,speed:1,
    last_send_state:"",sent_count:0,server_confirmed:false,
    server_play_time:0,end_reason:"",confirmed:false,resumable:false};
  const {XuexitongHeartbeatPanel}=load("components/XuexitongHeartbeatPanel.tsx",{
    "../bridge":{
      friendlyBridgeError:error=>String(error),
      request:async ({operation})=>{
        if(operation==="xuexitong.settings.get")return {playback_speed:1,concurrency:2,skip_completed:true,verify_after_run:true};
        if(operation==="xuexitong.heartbeat.logs")return {ok:true,events:[]};
        if(operation==="xuexitong.heartbeat.status")return {
          ok:true,running:false,paused:false,run_id:"",course_key:course.course_id,
          config:{speed:1,jobs:2,instant_complete:false,randomize_interval:false},
          task_count:withTasks?1:0,tasks:withTasks?[task]:[],
          heartbeats:{sent:0,server_confirmed:0},
          queue_controls:{pause:false,resume:false,stop:false}
        };
        throw Error("Unexpected IPC "+operation);
      }
    }
  });
  let view;
  try{
    await act(async()=>{view=create(React.createElement(XuexitongHeartbeatPanel,{course,desktop:true}));});
    assert.equal(view.root.findAllByProps({className:"sf-stat-grid"}).length,1);
    assert.equal(view.root.findAllByProps({className:"sf-xxt-empty"}).length,1);
    assert.equal(view.root.findAllByType("table").length,0);
    withTasks=true;
    const refresh=view.root.findAllByType("button").find(button=>button.props.children==="刷新");
    await act(async()=>{refresh.props.onClick();});
    assert.equal(view.root.findAllByProps({className:"sf-xxt-empty"}).length,0);
    assert.equal(view.root.findAllByType("table").length,1);
    assert.match(JSON.stringify(view.toJSON()),/任务名称/);
  }finally{
    if(view)await act(async()=>{view.unmount();});
  }
});
