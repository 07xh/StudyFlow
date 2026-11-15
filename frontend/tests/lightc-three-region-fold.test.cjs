const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const React=require("react");
const {create,act}=require("react-test-renderer");

const read=relative=>fs.readFileSync(path.join(__dirname,"..","src",relative),"utf8");

test("LightC workspace header spans both columns and the slim sidebar begins below it",()=>{
  const shell=read("ui/AppShell.tsx");
  const css=read("ui/foundation.css");
  const header=shell.indexOf('<header className="sf-header sf-workspace-header">');
  const sidebar=shell.indexOf('<aside className="sf-floating-nav" aria-label="主导航">');
  const main=shell.indexOf('<main className="main" id="main-content">');
  assert.ok(header>=0&&sidebar>header&&main>sidebar);
  assert.match(shell,/currentPlatform\?\?"全部平台"/);
  assert.match(shell,/currentCourseTitle\?</);
  assert.match(shell,/courseProgress==null\?"—"/);
  assert.match(css,/\.sf-shell \.sf-workspace-header\{[\s\S]*?grid-column:1 \/ -1/);
  assert.match(css,/\.sf-shell \.sf-floating-nav\{[\s\S]*?grid-column:1;[\s\S]*?grid-row:2/);
  assert.match(css,/\.sf-shell \.main\{[\s\S]*?grid-column:2;[\s\S]*?grid-row:2/);
});

function loadCollapsibleSection(){
  const source=read("ui/CollapsibleSection.tsx");
  const compiled=ts.transpileModule(source,{compilerOptions:{
    jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020
  }}).outputText;
  const module={exports:{}};
  new Function("module","exports","require",compiled)(module,module.exports,name=>{
    if(name==="lucide-react")return {ChevronDown:()=>null};
    if(name.endsWith(".css"))return {};
    return require(name);
  });
  return module.exports.CollapsibleSection;
}

test("each fold remembers its choice and keeps mounted content hidden rather than removed",()=>{
  const previousWindow=global.window;
  const store=new Map();
  global.window={localStorage:{
    getItem:key=>store.has(key)?store.get(key):null,
    setItem:(key,value)=>store.set(key,value)
  }};
  const CollapsibleSection=loadCollapsibleSection();
  let tree;
  try{
    act(()=>{tree=create(React.createElement(CollapsibleSection,{
      id:"course:zhidao:one:runtime",title:"当前任务",defaultExpanded:true
    },React.createElement("span",{className:"keep-me-mounted"},"运行状态")));});
    let button=tree.root.findByType("button");
    assert.equal(button.props["aria-expanded"],true);
    act(()=>button.props.onClick());
    button=tree.root.findByType("button");
    assert.equal(button.props["aria-expanded"],false);
    assert.equal(tree.root.findByProps({className:"sf-fold-body"}).props.hidden,true);
    assert.equal(tree.root.findByProps({className:"keep-me-mounted"}).children[0],"运行状态");
    assert.equal(store.get("studyflow.section.expanded.v1.course:zhidao:one:runtime"),"false");
    act(()=>tree.unmount());
    act(()=>{tree=create(React.createElement(CollapsibleSection,{
      id:"course:zhidao:one:runtime",title:"当前任务",defaultExpanded:true
    },"again"));});
    assert.equal(tree.root.findByType("button").props["aria-expanded"],false);
    act(()=>tree.update(React.createElement(CollapsibleSection,{
      id:"course:zhidao:two:runtime",title:"当前任务",defaultExpanded:true
    },"different course")));
    assert.equal(tree.root.findByType("button").props["aria-expanded"],true);
  }finally{
    if(tree)act(()=>tree.unmount());
    if(previousWindow===undefined)delete global.window;
    else global.window=previousWindow;
  }
});

test("course progress uses verified evidence in header and is not repeated in body",()=>{
  const app=read("App.tsx");
  assert.match(app,/const activeCourseProgress=activeMetric\?\.percent\?\?null;/);
  assert.match(app,/courseProgress=\{activeCourseProgress\}/);
  assert.match(app,/const scope="course:"\+course\.platform\+":"\+course\.course_id\+":";/);
  assert.doesNotMatch(app,/sf-course-total-progress/);
  assert.match(app,/title="当前课程任务"/);
  assert.match(app,/<SettingsDialog open=\{courseLogsOpen\}/);
});
