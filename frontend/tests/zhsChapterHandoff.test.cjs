const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {create,act}=require("react-test-renderer");
const load=require("./helpers/load.cjs");
const Panel=load("components/ZhsQueuePanel.tsx",{
  "legacyPlayback.ts":{stopZhsVideo:async()=>{},legacyError:String,legacyExitMessage:()=>"",zhsDiagnosticMessage:()=>""}
}).ZhsQueuePanel;
const id="a".repeat(32);
const row=(resource,chapter,state,percent)=>({
  task_id:(resource==="first"?"b":"c").repeat(32),chapter_key:chapter==="第一章"?"shared-1":"shared-2",
  chapter_name:chapter,name:resource==="first"?"第一节":"第二节",
  kind:"video",state,percent,stale:percent===null,exit_code:null
});
const status=tasks=>({
  platform:"zhidao",state:"running",run_id:id,exit_code:null,
  zhs_queue:{concurrency:2,state:"running",stale:false,tasks}
});
const words=n=>typeof n==="string"?n:(n.children??[]).map(words).join("");
test("new chapter retains a neutral empty track until its first valid sample",async()=>{
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Panel,{
      status:status([row("first","第一章","exited",null),row("next","第二章","running",null)]),
      onRefresh:async()=>{}
    }));});
    assert.match(words(view.root),/第二章/);
    const tracks=view.root.findAllByProps({role:"progressbar"});
    assert.equal(tracks.length,1);
    assert.equal(tracks[0].props["aria-valuenow"],undefined);
    assert.match(tracks[0].props.className,/is-unverified/);
    assert.equal(tracks[0].findAllByType("span")[0].props.style.width,"0%");
    assert.match(tracks[0].props["aria-valuetext"],/等待当前资源的有效进度采样/);
    assert.doesNotMatch(words(view.root),/100\.0%/);
    await act(async()=>{view.update(React.createElement(Panel,{
      status:status([row("first","第一章","exited",null),row("next","第二章","running",36)]),
      onRefresh:async()=>{}
    }));});
    const fresh=view.root.findAllByProps({role:"progressbar"});
    assert.equal(fresh.length,1);
    assert.equal(fresh[0].props["aria-valuenow"],36);
    assert.match(words(view.root),/36\.0%/);
  }finally{if(view)await act(async()=>view.unmount());}
});
test("between chapters with no running workers the task track remains visible without fabricated percent",async()=>{
  let view;
  try{
    await act(async()=>{view=create(React.createElement(Panel,{
      status:status([row("first","第一章","exited",null),row("next","第二章","queued",null)]),
      onRefresh:async()=>{}
    }));});
    assert.match(words(view.root),/正在分配下一项/);
    assert.match(words(view.root),/第二章/);
    const tracks=view.root.findAllByProps({role:"progressbar"});
    assert.equal(tracks.length,1);
    assert.equal(tracks[0].props["aria-valuenow"],undefined);
    assert.match(tracks[0].props.className,/is-indeterminate/);
  }finally{if(view)await act(async()=>view.unmount());}
});
