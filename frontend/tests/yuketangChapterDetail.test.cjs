const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const React=require("react");
const {create,act}=require("react-test-renderer");

function sharedViews(){
  const source=fs.readFileSync(path.join(__dirname,"../src/ui/CourseRecordViews.tsx"),"utf8");
  const code=ts.transpileModule(source,{fileName:"CourseRecordViews.tsx",compilerOptions:{
    module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020
  }}).outputText;
  const mod={exports:{}};
  new Function("module","exports","require",code)(mod,mod.exports,require);
  return mod.exports;
}

function component(request){
  const source=fs.readFileSync(path.join(__dirname,"../src/components/YuketangCourseDetailPanel.tsx"),"utf8");
  const code=ts.transpileModule(source,{fileName:"YuketangCourseDetailPanel.tsx",compilerOptions:{
    module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020
  }}).outputText;
  const mod={exports:{}};
  new Function("module","exports","require",code)(mod,mod.exports,name=>
    name==="../bridge"?{request,friendlyBridgeError:()=> "读取失败"}:
    name==="../ui/CourseRecordViews"?sharedViews():require(name));
  const Panel=mod.exports.YuketangCourseDetailPanel;
  Panel.verify=mod.exports.verifyYuketangCourse;
  Panel.verifyPlayed=mod.exports.verifyYuketangPlayedVideo;
  Panel.reset=mod.exports.resetYuketangVerification;
  Panel.summary=mod.exports.getYuketangVideoSummary;
  Panel.subscribeOverview=mod.exports.subscribeYuketangVerification;
  Panel.overviewRevision=mod.exports.getYuketangVerificationRevision;
  return Panel;
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
  const secondChapter=view.root.findAllByType("button").find(button=>
    String(button.props.className||"").includes("sf-ykt-chapter-toggle")&&button.props["aria-expanded"]===false);
  assert.ok(secondChapter);
  await act(async()=>{secondChapter.props.onClick();});
  assert.match(JSON.stringify(view.toJSON()),/服务器未返回可确认的进度/);
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

test("failed manual refresh preserves last server verified rows",async()=>{
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
  assert.match(JSON.stringify(view.toJSON()),/手动刷新未成功/);
  assert.match(JSON.stringify(view.toJSON()),/视频12/);
  assert.match(JSON.stringify(view.toJSON()),/50.0%/);
  act(()=>view.unmount());
});

test("progress batches automatically verify all lessons without another click",async()=>{
  const seen=[];
  const first=Array.from({length:8},(_,i)=>video(String(i+1),"第一章",100));
  const second=[video("9","第二章",60),video("10","第二章",null)];
  const Panel=component(async req=>{
    seen.push(req.offset);
    return req.offset===0?page(first,0,10,8):page(second,8,10,null);
  });
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  assert.deepEqual(seen,[0,8]);
  const secondChapter=view.root.findAllByType("button").find(button=>
    String(button.props.className||"").includes("sf-ykt-chapter-toggle")&&button.props["aria-expanded"]===false);
  assert.ok(secondChapter);
  await act(async()=>{secondChapter.props.onClick();});
  const out=JSON.stringify(view.toJSON());
  assert.match(out,/视频10/);
  assert.match(out,/60.0%/);
  assert.match(out,/本次已读取/);
  assert.doesNotMatch(out,/继续核验剩余视频/);
  act(()=>view.unmount());
});

test("later batch failure retains verified evidence and resumes at failed offset",async()=>{
  const seen=[];
  const first=Array.from({length:8},(_,i)=>video(String(i+1),"第一章",100));
  const second=[video("9","第二章",40)];
  let failing=true;
  const Panel=component(async req=>{
    seen.push(req.offset);
    if(req.offset===0)return page(first,0,9,8);
    if(failing)throw Error("network");
    return page(second,8,9,null);
  });
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  let out=JSON.stringify(view.toJSON());
  assert.deepEqual(seen,[0,8]);
  assert.match(out,/部分视频已读取并保留真实服务器记录/);
  assert.match(out,/视频1/);
  assert.doesNotMatch(out,/视频9/);
  const retry=view.root.findAllByType("button").find(button=>
    String(button.props.children).includes("继续核验剩余视频"));
  assert.ok(retry);
  failing=false;
  await act(async()=>{retry.props.onClick();});
  assert.deepEqual(seen,[0,8,8]);
  const secondChapter=view.root.findAllByType("button").find(button=>
    String(button.props.className||"").includes("sf-ykt-chapter-toggle")&&button.props["aria-expanded"]===false);
  await act(async()=>{secondChapter.props.onClick();});
  out=JSON.stringify(view.toJSON());
  assert.match(out,/视频9/);
  assert.doesNotMatch(out,/继续核验剩余视频/);
  act(()=>view.unmount());
});

test("a 63-video course is fully verified with eight bounded sequential page requests",async()=>{
  const seen=[];
  const all=Array.from({length:63},(_,i)=>video(String(i+1),"第"+(Math.floor(i/10)+1)+"章",i%2===0?100:null));
  const Panel=component(async req=>{
    seen.push(req.offset);
    const items=all.slice(req.offset,req.offset+req.limit);
    const end=req.offset+items.length;
    return page(items,req.offset,all.length,end<all.length?end:null);
  });
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  assert.deepEqual(seen,[0,8,16,24,32,40,48,56]);
  const out=JSON.stringify(view.toJSON());
  assert.match(out,/本次已读取/);
  assert.match(out,/尚无服务器确认记录/);
  assert.doesNotMatch(out,/继续核验剩余视频/);
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


test("Rain Classroom filters only fetched verified states and supports chapter expansion",async()=>{
  const Panel=component(async()=>page([
    video("done","第一章",100),video("pending","第一章",60),video("unknown","第二章",null)
  ]));
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  const pick=label=>view.root.findAllByType("button").find(button=>
    button.props["aria-pressed"]!==undefined&&
    String(button.props.children[0]).trim()===label);
  assert.match(JSON.stringify(view.toJSON()),/视频done/);
  await act(async()=>{pick("待完成").props.onClick();});
  let out=JSON.stringify(view.toJSON());
  assert.match(out,/视频pending/);
  assert.doesNotMatch(out,/视频done/);
  assert.doesNotMatch(out,/视频unknown/);
  await act(async()=>{pick("未核验").props.onClick();});
  out=JSON.stringify(view.toJSON());
  assert.match(out,/视频unknown/);
  assert.doesNotMatch(out,/0.0%/);
  await act(async()=>{pick("已完成").props.onClick();});
  assert.match(JSON.stringify(view.toJSON()),/视频done/);
  const collapse=view.root.findAllByType("button").find(button=>button.props.children==="收起全部");
  await act(async()=>{collapse.props.onClick();});
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/视频done/);
  const expand=view.root.findAllByType("button").find(button=>button.props.children==="展开全部");
  await act(async()=>{expand.props.onClick();});
  assert.match(JSON.stringify(view.toJSON()),/视频done/);
  act(()=>view.unmount());
});

test("Rain Classroom shares search and chapter controls with Zhidao",async()=>{
  const Panel=component(async()=>page([
    video("a","章节A",80),video("b","章节B",100),
  ]));
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  const findButton=label=>view.root.findAllByType("button")
    .find(button=>button.props["aria-label"]===label);
  await act(async()=>{findButton("搜索学习记录").props.onClick();});
  const input=view.root.findByType("input");
  await act(async()=>{input.props.onChange({target:{value:"视频b"}});});
  let out=JSON.stringify(view.toJSON());
  assert.doesNotMatch(out,/视频a/);
  const collapse=view.root.findAllByType("button")
    .find(button=>button.props.children==="收起全部");
  await act(async()=>{collapse.props.onClick();});
  assert.equal(view.root.findAllByType("article").length,0);
  const expand=view.root.findAllByType("button")
    .find(button=>button.props.children==="展开全部");
  await act(async()=>{expand.props.onClick();});
  out=JSON.stringify(view.toJSON());
  assert.match(out,/视频b/);
  await act(async()=>{input.props.onChange({target:{value:""}});});
  const select=view.root.findByType("select");
  await act(async()=>{select.props.onChange({target:{value:"章节A"}});});
  out=JSON.stringify(view.toJSON());
  assert.match(out,/章节A/);
  assert.doesNotMatch(out,/视频b/);
  act(()=>view.unmount());
});

test("99.999% verified video cannot be displayed as server-completed 100%",async()=>{
  const Panel=component(async()=>page([{
    ...video("near","第一章",99.999),server_completed:false
  }]));
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  const out=JSON.stringify(view.toJSON());
  assert.match(out,/99.9%/);
  assert.match(out,/服务器已核验 · 尚未完成/);
  assert.doesNotMatch(out,/100.0%/);
  act(()=>view.unmount());
});

test("initial entry verifies once; later page navigation reuses the server snapshot",async()=>{
  let calls=0;
  const Panel=component(async()=>{calls++;return page([video("x","章节1",40)]);});
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  assert.equal(calls,1);
  assert.match(JSON.stringify(view.toJSON()),/40.0%/);
  act(()=>view.unmount());
  await act(async()=>{view=create(React.createElement(Panel,props));});
  assert.equal(calls,1);
  assert.match(JSON.stringify(view.toJSON()),/上次全课核验/);
  assert.match(JSON.stringify(view.toJSON()),/40.0%/);
  act(()=>view.unmount());
});

test("manual full refresh is explicit and replaces the prior complete snapshot",async()=>{
  let rate=10,calls=0;
  const Panel=component(async()=>{calls++;return page([video("x","章节1",rate)]);});
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  rate=75;
  assert.equal(calls,1);
  const refresh=view.root.findAllByType("button").find(button=>
    button.props.className==="secondary"&&
    button.props.children?.some?.(item=>item==="重新核验全课"));
  assert.ok(refresh);
  await act(async()=>{refresh.props.onClick();});
  assert.equal(calls,2);
  assert.match(JSON.stringify(view.toJSON()),/75.0%/);
  act(()=>view.unmount());
});

test("playback verified video updates only one server row, no full-course recheck",async()=>{
  const queries=[];
  let updated=false;
  const Panel=component(async request=>{
    queries.push([request.offset,request.limit]);
    if(request.limit===1){
      assert.equal(request.offset,1);
      return page([video("b","第二章",updated?85:20)],1,2,null);
    }
    return page([video("a","第一章",100),video("b","第二章",20)]);
  });
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  assert.deepEqual(queries,[[0,8]]);
  updated=true;
  await act(async()=>{
    assert.equal(await Panel.verifyPlayed("123","视频b",{
      desktop:true,connected:true,scopeDirty:false
    }),true);
  });
  assert.deepEqual(queries,[[0,8],[1,1]]);
  const chapter=view.root.findAllByType("button").find(node=>
    String(node.props.className||"").includes("sf-ykt-chapter-toggle")&&node.props["aria-expanded"]===false);
  assert.ok(chapter);
  await act(async()=>{chapter.props.onClick();});
  assert.match(JSON.stringify(view.toJSON()),/85.0%/);
  assert.match(JSON.stringify(view.toJSON()),/最近播放视频复核/);
  act(()=>view.unmount());
});

test("ambiguous playback names never guess which video to refresh",async()=>{
  let calls=0;
  const Panel=component(async()=>{calls++;return page([
    {...video("a","第一章",10),name:"同名"},
    {...video("b","第二章",20),name:"同名"},
  ]);});
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  assert.equal(await Panel.verifyPlayed("123","同名",{
    desktop:true,connected:true,scopeDirty:false
  }),false);
  assert.equal(calls,1);
  act(()=>view.unmount());
});

test("playback cannot overwrite a verified record with missing server evidence",async()=>{
  const Panel=component(async req=>req.limit===1
    ?page([video("a","第一章",null)],0,1,null)
    :page([video("a","第一章",42)]));
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  await act(async()=>{
    assert.equal(await Panel.verifyPlayed("123","视频a",{
      desktop:true,connected:true,scopeDirty:false
    }),false);
  });
  assert.match(JSON.stringify(view.toJSON()),/42.0%/);
  act(()=>view.unmount());
});

test("changed account/scope invalidates both the snapshot and late server response",async()=>{
  let reply;
  const Panel=component(()=>new Promise(resolve=>{reply=resolve;}));
  const run=Panel.verify("123",{desktop:true,connected:true,scopeDirty:false});
  Panel.reset();
  reply(page([video("stale","旧章节",99)]));
  await run;
  let view;
  await act(async()=>{view=create(React.createElement(Panel,{
    ...props,connected:false
  }));});
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/旧章节/);
  act(()=>view.unmount());
});

test("Rain Classroom overview reuses the real verification snapshot and receives targeted updates",async()=>{
  const calls=[];
  const Panel=component(async req=>{
    calls.push({offset:req.offset,limit:req.limit});
    if(req.limit===1)return page([video("b","章节",100)],1,2,null);
    return page([video("a","章节",100),video("b","章节",50)],0,2,null);
  });
  let changes=0;
  const unsubscribe=Panel.subscribeOverview(()=>{changes++;});
  let view;
  await act(async()=>{view=create(React.createElement(Panel,props));});
  const first=Panel.summary("123");
  assert.equal(first.complete,true);
  assert.equal(first.verified,2);
  assert.equal(first.completed,1);
  assert.equal(calls.length,1);
  const revision=Panel.overviewRevision();
  await act(async()=>{view.unmount();});
  await act(async()=>{assert.equal(await Panel.verifyPlayed("123","视频b",
    {desktop:true,connected:true,scopeDirty:false},true),true);});
  assert.equal(Panel.summary("123").completed,2);
  assert.equal(calls.length,2,"single-video verification must not rescan the course");
  assert.deepEqual(calls[1],{offset:1,limit:1});
  assert.ok(Panel.overviewRevision()>revision);
  assert.ok(changes>=3,"first scan and targeted follow-up notify the platform overview");
  unsubscribe();
});
