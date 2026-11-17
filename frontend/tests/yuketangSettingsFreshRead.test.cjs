const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const words=n=>typeof n==="string"?n:(n.children??[]).map(words).join("");
const original={
  video_speed:1.5,heartbeat_interval:5,max_concurrent_videos:3,completion_threshold:90,
  skip_completed:true,use_concurrent:true,test_mode:false,test_video_count:5,
  auto_richtext:false,debug:false,richtext_stay_seconds:3,richtext_skip_delay:1
};

test("Rain Classroom new launch uses fresh persisted platform settings, not stale mounted props",async()=>{
  const saved={...original,video_speed:2,max_concurrent_videos:5,debug:true};
  const launches=[],queries=[];
  const previous=global.window;
  global.window={setInterval:()=>1,clearInterval:()=>{}};
  const Panel=load("components/LegacyPlaybackPanel.tsx",{
    "../bridge":{
      request:async message=>{
        queries.push(message.operation);
        if(message.operation==="yuketang.scope.get")return {
          has_session:true,classroom_id:"123",university_id:"456"
        };
        if(message.operation==="yuketang.settings.get")return saved;
        if(message.operation==="yuketang.session.marker")return {marker:"a".repeat(64)};
        throw Error("Unexpected IPC "+message.operation);
      },
      friendlyBridgeError:e=>String(e)
    },
    "../legacyPlayback":{
      originalYktDefaults:original,
      validateOriginalOptions:()=>true,
      readYuketangCourseThreshold:()=>80,
      getLegacyStatus:async()=>({platform:"yuketang",state:"idle",run_id:null}),
      getYuketangLiveProgress:async()=>({video_tasks:[]}),
      startLegacy:async (platform,courseId,options)=>{
        launches.push({platform,courseId,options});
        return {platform,state:"running",run_id:"task-123",course_id:null};
      },
      legacyError:e=>String(e),legacyExitMessage:()=>"",zhsDiagnosticMessage:()=>"",
      stopLegacy:async()=>({platform:"yuketang",state:"stopped"}),
    },
    "../taskRecovery":{rememberTaskRecovery:()=>true,discardTaskRecovery:()=>{}},
    "./ZhsTaskSettingsPanel":{ZhsTaskSettingsPanel:()=>null},
    "./ZhsQueuePanel":{ZhsQueuePanel:()=>null},
    "./RunParameters":{RunParameters:()=>null}
  }).LegacyPlaybackPanel;
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Panel,{
      platform:"yuketang",courses:[],desktop:true,connected:true,
      yuketangOptions:original,settingsReady:true
    }));});
    const button=view.root.findAllByType("button")
      .find(n=>words(n).includes("启动平台批量任务"));
    assert.ok(button);
    assert.equal(button.props.disabled,false);
    await act(async()=>{button.props.onClick();});
    assert.deepEqual(queries.slice(0,2),["yuketang.scope.get","yuketang.settings.get"]);
    assert.equal(launches.length,1);
    assert.equal(launches[0].options.video_speed,2);
    assert.equal(launches[0].options.max_concurrent_videos,5);
    assert.equal(launches[0].options.debug,true);
    assert.equal(launches[0].options.completion_threshold,80,
      "per-classroom choice must still apply after fresh platform settings read");
  }finally{
    if(view)await act(async()=>view.unmount());
    if(previous===undefined)delete global.window;else global.window=previous;
  }
});
