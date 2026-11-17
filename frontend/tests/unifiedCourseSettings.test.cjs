const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const root=path.resolve(__dirname,"../src");
const textOf=node=>typeof node==="string"?node:
  (node.children??[]).map(textOf).join("");
const key="b".repeat(64);
const defaults={
  speed:1.5,speed_cap:2,limit_minutes:0,learn_optional:false,
  max_videos:0,stop_on_error:false,concurrency:2,completion_threshold:null
};

test("selected course offers one parameter entry and hides duplicate ZHS entry",()=>{
  const app=fs.readFileSync(path.join(root,"App.tsx"),"utf8");
  const runtime=fs.readFileSync(path.join(root,"components/LegacyPlaybackPanel.tsx"),"utf8");
  const zhs=fs.readFileSync(path.join(root,"components/ZhsTaskSettingsPanel.tsx"),"utf8");
  const start=app.indexOf("const renderCourseWorkspace=");
  const end=app.indexOf("const activeSelectedCourse=",start);
  assert.ok(start>0&&end>start);
  const course=app.slice(start,end);
  assert.equal((course.match(/className="secondary sf-course-settings-action"/g)||[]).length,1);
  assert.match(course,/if\(course\.platform==="zhidao"&&mode==="zhs-original"\)/);
  assert.match(course,/onCourseSettingsClose=\{\(\)=>setZhsCourseSettingsOpen\(false\)\}/);
  assert.match(runtime,/hideTrigger=\{detailMode\}/);
  assert.match(zhs,/!hideTrigger&&<button/);
  assert.doesNotMatch(course,/>平台设置\s*<\/button>/);
  assert.match(course,/>参数设置\s*<\/button>/);
});

test("controlled ZHS dialog opens from course toolbar and leaves runner settings mounted when closed",async()=>{
  const previous=global.window;
  const storage=new Map();
  global.window={localStorage:{
    getItem:k=>storage.get(k)??null,
    setItem:(k,v)=>storage.set(k,v)
  }};
  const reads=[],ready=[];
  let closes=0;
  const Panel=load("components/ZhsTaskSettingsPanel.tsx",{
    "bridge.ts":{
      request:async req=>{
        if(req.operation==="zhidao.zhs.settings.get"){
          reads.push(req);return {...defaults};
        }
        if(req.operation==="zhidao.course.detail")
          return {course_key:key,verified:false,stale:false,items:[]};
        throw Error("Unexpected "+req.operation);
      },
      friendlyBridgeError:e=>String(e)
    },
    "legacyPlayback.ts":{
      originalZhsDefaults:defaults,
      validateZhsStoredOptions:x=>x?.speed===1.5&&x?.concurrency===2,
      validateZhsOptions:x=>x?.scope_mode==="all"
    },
    "ui/SettingsDialog.tsx":{
      SettingsDialog:({open,onClose,navigation,children,footer})=>open
        ?React.createElement("div",{id:"controlled-dialog"},
          React.createElement("button",{id:"close-dialog",onClick:onClose},"关闭"),
          navigation,children,footer)
        :null
    }
  }).ZhsTaskSettingsPanel;
  let view;
  const make=open=>React.createElement(Panel,{
    desktop:true,courseId:key,courseType:"shared",settingsOpen:open,
    onSettingsClose:()=>{closes++;},hideTrigger:true,onReady:value=>ready.push(value)
  });
  try{
    await act(async()=>{view=create(make(false));});
    assert.equal(view.root.findAllByProps({id:"controlled-dialog"}).length,0);
    assert.ok(ready.some(x=>x?.scope_mode==="all"),
      "course runner should receive stored options even while dialog is hidden");
    assert.doesNotMatch(textOf(view.root),/点击设置/);
    const before=reads.length;
    await act(async()=>view.update(make(true)));
    assert.equal(view.root.findAllByProps({id:"controlled-dialog"}).length,1);
    assert.ok(reads.length>before,"opening should re-read the persisted course settings");
    const buttons=view.root.findAllByType("button");
    const scope=buttons.find(n=>textOf(n)==="课程范围");
    assert.ok(scope);
    await act(async()=>scope.props.onClick());
    assert.match(textOf(view.root),/本次选择的资源类型/);
    await act(async()=>view.root.findByProps({id:"close-dialog"}).props.onClick());
    assert.equal(closes,1);
    await act(async()=>view.update(make(false)));
    assert.equal(view.root.findAllByProps({id:"controlled-dialog"}).length,0);
    assert.ok(ready.at(-1)?.scope_mode==="all",
      "hiding the editor must not erase the validated runner settings");
  }finally{
    if(view)await act(async()=>view.unmount());
    if(previous===undefined)delete global.window;else global.window=previous;
  }
});
