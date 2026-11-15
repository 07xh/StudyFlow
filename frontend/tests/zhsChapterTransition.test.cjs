const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");
const Panel=load("components/ZhsQueuePanel.tsx",{
  "legacyPlayback.ts":{stopZhsVideo:async()=>{},legacyError:String,legacyExitMessage:()=>"",zhsDiagnosticMessage:()=>""}
}).ZhsQueuePanel;
const id="a".repeat(32);
const row=(kind,chapter,state,percent)=>({
  task_id:(kind==="first"?"b":"c").repeat(32),chapter,name:kind==="first"?"视频一":"视频二",
  kind:"video",state,percent,stale:percent===null,exit_code:null
});
const makeStatus=tasks=>({
  platform:"zhidao",state:"running",run_id:id,exit_code:null,
  zhs_queue:{concurrency:1,state:"running",stale:false,tasks}
});
const words=node=>typeof node==="string"?node:(node.children??[]).map(words).join("");
test("switching chapters shows the next chapter and a persistent nonnumeric loading bar",async()=>{
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Panel,{
      status:makeStatus([row("first","第一章","exited",null),row("next","第二章","running",null)]),
      onRefresh:async()=>{}
    }));});
    assert.match(words(view.root),/当前执行章节：第二章/);
    const tracks=view.root.findAllByProps({role:"progressbar"});
    assert.equal(tracks.length,1);
    assert.equal(tracks[0].props["aria-valuenow"],undefined);
    assert.match(tracks[0].props.className,/is-indeterminate/);
    assert.match(tracks[0].props["aria-valuetext"],/尚无有效视频进度采样/);
    await act(async()=>{view.update(React.createElement(Panel,{
      status:makeStatus([row("first","第一章","exited",null),row("next","第二章","running",36)]),
      onRefresh:async()=>{}
    }));});
    const fresh=view.root.findAllByProps({role:"progressbar"});
    assert.equal(fresh[0].props["aria-valuenow"],36);
    assert.match(words(view.root),/36.0%/);
  }finally{if(view)await act(async()=>view.unmount());}
});
test("a queue handoff with no active worker still retains an indeterminate progress track",async()=>{
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Panel,{
      status:makeStatus([row("first","第一章","exited",null),row("next","第二章","queued",null)]),
      onRefresh:async()=>{}
    }));});
    assert.match(words(view.root),/正在分配下一项/);
    assert.match(words(view.root),/第二章/);
    const track=view.root.findAllByProps({role:"progressbar"});
    assert.equal(track.length,1);
    assert.equal(track[0].props["aria-valuenow"],undefined);
  }finally{if(view)await act(async()=>view.unmount());}
});
