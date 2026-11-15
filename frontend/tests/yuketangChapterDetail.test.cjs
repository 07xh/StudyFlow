const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const React=require("react");
const {create,act}=require("react-test-renderer");

function component(request){
  const source=fs.readFileSync(path.join(__dirname,"../src/components/YuketangCourseDetailPanel.tsx"),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJS,target:ts.ScriptTarget.ES2020
  }}).outputText;
  const mod={exports:{}};
  new Function("module","exports","require",code)(mod,mod.exports,name=>
    name==="../bridge"?{request,friendlyBridgeError:()=> "读取失败"}:require(name));
  return mod.exports.YuketangCourseDetailPanel;
}
const course={platform:"yuketang",course_id:"123",title:"课程"};
const props={course,desktop:true,connected:true,scopeDirty:false};
const video=(id,chapter,percent)=>({
  id,name:"视频"+id,chapter,progress_percent:percent,
  server_completed:percent===null?null:percent===100,
  last_point_seconds:percent===null?null:25,
  duration_seconds:percent===null?null:100,
  verified_at:percent===null?null:"2026-11-15T08:00:00Z",
});
const page=(items,offset=0,total=items.length,next_offset=null)=>({
  course_id:"123",items,offset,total,next_offset
});

test("Rain Classroom per-lesson server progress groups chapters and never invents unknown completion",async()=>{
  const seen=[];
  const Panel=component(async request=>{
    seen.push(request);
    return page([video("12","第一章",42.5),video("13","第二章",null)]);
  });
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  const output=JSON.stringify(view.toJSON());
  assert.match(output,/第一章/);
  assert.match(output,/第二章/);
  assert.match(output,/视频12/);
  assert.match(output,/42.5%/);
  assert.match(output,/服务器未返回可确认的进度/);
  assert.match(output,/已确认完成/);
  assert.doesNotMatch(output,/0.0%/);
  assert.equal(seen.length,1);
  assert.deepEqual(seen[0],{operation:"yuketang.course.detail",course_id:"123",offset:0,limit:8});
  act(()=>view.unmount());
});

test("unsaved classroom scope blocks progress reads and clears previous course content",async()=>{
  let calls=0;
  const Panel=component(async()=>{calls++;return page([video("12","第一章",50)]);});
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  await act(async()=>{view.update(React.createElement(Panel,{...props,scopeDirty:true}));});
  assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/视频12/);
  assert.match(JSON.stringify(view.toJSON()),/课堂范围尚未保存/);
  act(()=>view.unmount());
});

test("failed refresh does not retain stale per-video percentages",async()=>{
  let calls=0;
  const Panel=component(async()=>{
    calls++;
    if(calls>1)throw Error("offline");
    return page([video("12","第一章",50)]);
  });
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  const button=view.root.findAllByType("button")[0];
  await act(async()=>{button.props.onClick();});
  assert.match(JSON.stringify(view.toJSON()),/读取失败/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/视频12/);
  act(()=>view.unmount());
});

test("progress batches remain ordered and new page cannot overwrite server evidence",async()=>{
  const seen=[];
  const first=Array.from({length:8},(_,i)=>video(String(i+1),"第一章",100));
  const second=[video("9","第二章",60),video("10","第二章",null)];
  const Panel=component(async req=>{
    seen.push(req.offset);
    return req.offset===0?page(first,0,10,8):page(second,8,10,null);
  });
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  assert.match(JSON.stringify(view.toJSON()),/剩余 2 节/);
  const more=view.root.findAllByType("button").find(button=>
    typeof button.props.onClick==="function"&&JSON.stringify(button.props.children).includes("继续核验"));
  assert.ok(more);
  await act(async()=>{more.props.onClick();});
  assert.deepEqual(seen,[0,8]);
  const out=JSON.stringify(view.toJSON());
  assert.match(out,/视频10/);
  assert.match(out,/60.0%/);
  assert.doesNotMatch(out,/剩余 2 节/);
  act(()=>view.unmount());
});

test("malformed or unverified server progress responses cannot be shown as verified",async()=>{
  const Panel=component(async()=>page([{
    ...video("12","第一章",null),
    server_completed:true,verified_at:"2026-11-15T08:00:00Z",
  }]));
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  const out=JSON.stringify(view.toJSON());
  assert.match(out,/读取失败/);
  assert.doesNotMatch(out,/视频12/);
  act(()=>view.unmount());
});
