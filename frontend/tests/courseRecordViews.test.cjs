const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const React=require("react");
const ts=require("typescript");
const {act,create}=require("react-test-renderer");

function loadToolbar(){
  const code=ts.transpileModule(
    fs.readFileSync(path.join(__dirname,"../src/ui/CourseRecordViews.tsx"),"utf8"),{
      fileName:"CourseRecordViews.tsx",
      compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}
    }).outputText;
  const mod={exports:{}};
  new Function("module","exports","require",code)(mod,mod.exports,require);
  return mod.exports.CourseRecordToolbar;
}
const Toolbar=loadToolbar();
const defaults={
  filters:[{id:"all",label:"全部",count:2},{id:"done",label:"已完成",count:1}],
  activeFilter:"all",onFilter:()=>{},chapters:["第一章"],chapter:"",onChapter:()=>{},
  visibleCount:2,totalCount:2,onExpandAll:()=>{}
};

test("shared magnifier search clears on close, does not retain hidden query",async()=>{
  let latestSearch="";
  function Host(){
    const [search,setSearch]=React.useState("");
    latestSearch=search;
    return React.createElement(Toolbar,{...defaults,search,onSearch:setSearch});
  }
  let view;
  await act(async()=>{view=create(React.createElement(Host));});
  const trigger=()=>view.root.findByProps({"aria-label":"搜索学习记录"});
  assert.equal(view.root.findAllByType("input").length,0);
  await act(async()=>{trigger().props.onClick();});
  const box=view.root.findByType("input");
  await act(async()=>{box.props.onChange({target:{value:"第一章"}});});
  assert.equal(latestSearch,"第一章");
  assert.equal(view.root.findByProps({"aria-label":"收起搜索"}).props["aria-expanded"],true);
  await act(async()=>{view.root.findByProps({"aria-label":"收起搜索"}).props.onClick();});
  assert.equal(latestSearch,"");
  assert.equal(view.root.findAllByType("input").length,0);
  act(()=>view.unmount());
});

test("Escape closes shared search and clears current filter on both platforms",async()=>{
  let latestSearch="";
  function Host(){
    const [search,setSearch]=React.useState("");
    latestSearch=search;
    return React.createElement(Toolbar,{...defaults,search,onSearch:setSearch});
  }
  let view;
  await act(async()=>{view=create(React.createElement(Host));});
  await act(async()=>{view.root.findByProps({"aria-label":"搜索学习记录"}).props.onClick();});
  const input=view.root.findByType("input");
  await act(async()=>{input.props.onChange({target:{value:"未完成"}});});
  let stopped=false;
  await act(async()=>{input.props.onKeyDown({key:"Escape",stopPropagation(){stopped=true;}});});
  assert.equal(stopped,true);
  assert.equal(latestSearch,"");
  assert.equal(view.root.findAllByType("input").length,0);
  act(()=>view.unmount());
});

test("course switches remount shared toolbar rather than leaking open search",()=>{
  for(const platform of ["ZhidaoCourseDetailPanel.tsx","YuketangCourseDetailPanel.tsx"]){
    const panel=fs.readFileSync(path.join(__dirname,"../src/components",platform),"utf8");
    assert.match(panel,/<CourseRecordToolbar key=\{course.course_id\}/);
  }
});
