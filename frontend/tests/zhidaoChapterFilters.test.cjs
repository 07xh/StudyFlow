const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const React=require("react");
const {create,act}=require("react-test-renderer");

function component(request){
  const source=fs.readFileSync(path.join(__dirname,"../src/components/ZhidaoCourseDetailPanel.tsx"),"utf8");
  const output=ts.transpileModule(source,{fileName:"ZhidaoCourseDetailPanel.tsx",
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}
  }).outputText;
  const mod={exports:{}};
  new Function("module","exports","require",output)(mod,mod.exports,name=>
    name==="../bridge"?{request,friendlyBridgeError:()=> "核验失败"}:require(name));
  return mod.exports.ZhidaoCourseDetailPanel;
}
const key="a".repeat(64);
const otherKey="b".repeat(64);
const baseCourse={platform:"zhidao",course_id:key,title:"课程",course_type:"ai",verified_at:"2026-11-15T12:00:00Z"};
const aiItems=[
  {name:"知识点甲",theme:"第一章",progress_percent:100,fully_progressed:true},
  {name:"知识点乙",theme:"第一章",progress_percent:45,fully_progressed:false},
  {name:"知识点丙",theme:"第一章"},
  {name:"知识点丁",theme:"第二章",progress_percent:15,fully_progressed:false},
];
const detail=(course_key=key,course_type="ai",items=aiItems)=>({
  course_key,title:"课程",course_type,verified:true,stale:false,
  verified_at:"2026-11-15T12:00:00Z",done:1,total:items.length,percent:25,items
});
const content=view=>JSON.stringify(view.toJSON());
const pills=view=>view.root.findAllByType("button").filter(b=>b.props["aria-pressed"]!==undefined&&
  b.props.className!=="sf-zd-search-trigger"&&
  !String(b.props.className).includes("sf-zd-search-trigger"));
const pick=(view,label)=>pills(view).find(b=>String(b.props.children[0]).trim()===label);
const chapterButtons=view=>view.root.findAllByType("button").filter(b=>
  String(b.props.className).includes("sf-ykt-chapter-toggle"));

test("Zhidao reuses Rain Classroom visible four-state chips with actual lesson counts",async()=>{
  const Panel=component(async()=>detail());
  let view;
  await act(async()=>{view=create(React.createElement(Panel,{course:baseCourse,desktop:true}));});
  assert.deepEqual(pills(view).map(b=>String(b.props.children[0]).trim()),
    ["全部","待完成","已完成","未核验"]);
  assert.deepEqual(pills(view).map(b=>b.props.children[2]?.props?.children??b.props.children[1].props.children),
    [4,2,1,1]);
  assert.equal(pick(view,"全部").props["aria-pressed"],true);
  assert.match(content(view),/已完成知识点/);
  assert.match(content(view),/服务端记录/);
  assert.equal(view.root.findAllByType("input").length,0,"search should be collapsed by default");
  act(()=>view.unmount());
});

test("status selection, chapter selection and grouped expand/collapse compose without data mutation",async()=>{
  let calls=0;
  const Panel=component(async()=>{calls++;return detail();});
  let view;
  await act(async()=>{view=create(React.createElement(Panel,{course:baseCourse,desktop:true}));});
  assert.equal(chapterButtons(view).length,2);
  assert.match(content(view),/知识点甲/);
  assert.doesNotMatch(content(view),/知识点丁/,"second chapter starts collapsed");
  await act(async()=>{pick(view,"待完成").props.onClick();});
  assert.match(content(view),/知识点乙/);
  assert.doesNotMatch(content(view),/知识点甲/);
  const select=view.root.findByProps({"aria-label":"选择章节或主题"});
  await act(async()=>{select.props.onChange({target:{value:"第二章"}});});
  assert.match(content(view),/显示 1 \/ 4 条/);
  assert.equal(chapterButtons(view).length,1);
  assert.match(content(view),/知识点丁/);
  const collapse=view.root.findAllByType("button").find(x=>x.props.children==="收起全部");
  await act(async()=>{collapse.props.onClick();});
  assert.doesNotMatch(content(view),/知识点丁/);
  const expand=view.root.findAllByType("button").find(x=>x.props.children==="展开全部");
  await act(async()=>{expand.props.onClick();});
  assert.match(content(view),/知识点丁/);
  assert.equal(calls,1,"client filtering must not issue progress network requests");
  act(()=>view.unmount());
});

test("magnifier is the compact search entry; close and Escape both clear invisible filters",async()=>{
  const Panel=component(async()=>detail());
  let view;
  await act(async()=>{view=create(React.createElement(Panel,{course:baseCourse,desktop:true}));});
  assert.equal(view.root.findAllByType("input").length,0);
  const open=()=>view.root.findByProps({"aria-label":"搜索内容"});
  await act(async()=>{open().props.onClick();});
  let input=view.root.findByProps({"aria-label":"搜索知识点、视频或章节"});
  await act(async()=>{input.props.onChange({target:{value:"不存在的词"}});});
  assert.match(content(view),/显示 0 \/ 4 条/);
  assert.match(content(view),/没有符合当前筛选条件/);
  await act(async()=>{view.root.findByProps({"aria-label":"关闭搜索并清除条件"}).props.onClick();});
  assert.equal(view.root.findAllByType("input").length,0);
  assert.match(content(view),/显示 4 \/ 4 条/);
  await act(async()=>{open().props.onClick();});
  input=view.root.findByProps({"aria-label":"搜索知识点、视频或章节"});
  await act(async()=>{input.props.onChange({target:{value:"知识点乙"}});});
  assert.match(content(view),/显示 1 \/ 4 条/);
  await act(async()=>{input.props.onKeyDown({key:"Escape"});});
  assert.equal(view.root.findAllByType("input").length,0);
  assert.match(content(view),/显示 4 \/ 4 条/);
  act(()=>view.unmount());
});

test("course switch clears search, status, chapter and expanded state; no previous evidence persists",async()=>{
  const seen=[];
  const Panel=component(async request=>{
    seen.push(request.course_key);
    return request.course_key===key?detail():detail(otherKey,"ai",[
      {name:"新课程唯一知识点",theme:"第一章",progress_percent:12,fully_progressed:false}
    ]);
  });
  let view;
  await act(async()=>{view=create(React.createElement(Panel,{course:baseCourse,desktop:true}));});
  await act(async()=>{pick(view,"已完成").props.onClick();});
  await act(async()=>{view.root.findByProps({"aria-label":"搜索内容"}).props.onClick();});
  const input=view.root.findByProps({"aria-label":"搜索知识点、视频或章节"});
  await act(async()=>{input.props.onChange({target:{value:"知识点甲"}});});
  await act(async()=>{view.update(React.createElement(Panel,{
    course:{...baseCourse,course_id:otherKey},desktop:true
  }));});
  const out=content(view);
  assert.match(out,/新课程唯一知识点/);
  assert.doesNotMatch(out,/知识点甲/);
  assert.equal(view.root.findAllByType("input").length,0);
  assert.equal(pick(view,"全部").props["aria-pressed"],true);
  assert.equal(seen.length,2);
  act(()=>view.unmount());
});

test("shared-course completion, incomplete and unverified are distinct server states",async()=>{
  const Panel=component(async()=>detail(key,"shared",[
    {name:"视频完成",chapter_name:"第一章",server_completed:true,studied_seconds:120,duration_seconds:120},
    {name:"视频未完成",chapter_name:"第一章",server_completed:false,studied_seconds:30,duration_seconds:120},
    {name:"视频未核验",chapter_name:"第一章"}
  ]));
  let view;
  await act(async()=>{view=create(React.createElement(Panel,{course:{...baseCourse,course_type:"shared"},desktop:true}));});
  assert.deepEqual(pills(view).map(x=>x.props.children[1].props.children),[3,1,1,1]);
  await act(async()=>{pick(view,"未核验").props.onClick();});
  assert.match(content(view),/视频未核验/);
  assert.doesNotMatch(content(view),/视频未完成/);
  assert.doesNotMatch(content(view),/视频完成/);
  act(()=>view.unmount());
});

test("responsive and accessibility contracts keep primary filters and search separate",()=>{
  const css=fs.readFileSync(path.join(__dirname,"../src/ui/foundation.css"),"utf8");
  const src=fs.readFileSync(path.join(__dirname,"../src/components/ZhidaoCourseDetailPanel.tsx"),"utf8");
  assert.match(src,/className="sf-ykt-progress-filters"/);
  assert.match(src,/className="sf-zd-filter-tools"/);
  assert.match(src,/aria-pressed=\{statusFilter===option.id\}/);
  assert.match(src,/aria-label=\{searchOpen\?"关闭搜索":"搜索内容"\}/);
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/\.sf-zd-unified-chapters \.sf-zd-search-panel/);
});
