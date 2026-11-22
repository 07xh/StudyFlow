const test=require("node:test");
const assert=require("node:assert/strict");
const React=require("react");
const {act,create}=require("react-test-renderer");
const load=require("./helpers/load.cjs");

const textOf=node=>typeof node==="string"?node:(node.children??[]).map(textOf).join("");
function button(view,label){
 const node=view.root.findAllByType("button").find(b=>textOf(b).includes(label));
 assert.ok(node,"missing button: "+label);
 return node;
}
function setup({desktop=true,documentResult}={}){
 const calls=[],visited=[];
 const invoke=async (name,args={})=>{
  calls.push({name,args});
  if(name==="studyflow_read_document")
   return documentResult||{id:args.documentId,title:"许可证原文",content:"这里是完整的文档正文"};
  return null;
 };
 const Panel=load("ui/AboutOpenSourcePanel.tsx",{
  "@tauri-apps/api/app":{getVersion:async()=>"0.1.1-rc.63"},
  "@tauri-apps/api/core":{invoke},
  "../bridge":{friendlyBridgeError:()=>"文档读取失败"},
 }).AboutOpenSourcePanel;
 return {Panel,calls,visited,desktop};
}

test("About is a dedicated product workspace with live version and developer navigation",async()=>{
 const {Panel,calls}=setup();
 let view,developerCount=0;
 await act(async()=>{view=create(React.createElement(Panel,{
  desktop:true,onOpenDeveloper:()=>{developerCount++;}
 }));});
 assert.match(textOf(view.root),/学序 StudyFlow/);
 assert.match(textOf(view.root),/v0.1.1-rc.63/);
 assert.match(textOf(view.root),/Windows 桌面应用/);
 assert.match(textOf(view.root),/独立第三方项目/);
 assert.equal(view.root.findAllByProps({role:"tab"}).length,2);
 assert.equal(view.root.findAllByProps({role:"dialog"}).length,0);
 const source=view.root.findAllByType("a").find(a=>textOf(a).includes("项目源码"));
 assert.equal(source.props.href,"https://github.com/07xh/StudyFlow");
 let prevented=false;
 await act(async()=>source.props.onClick({preventDefault(){prevented=true;}}));
 assert.ok(prevented);
 assert.deepEqual(calls.at(-1),{name:"studyflow_open_source_site",args:{kind:"repository"}});
 const release=view.root.findAllByType("a").find(a=>textOf(a).includes("发行版本"));
 await act(async()=>release.props.onClick({preventDefault(){}}));
 assert.deepEqual(calls.at(-1),{name:"studyflow_open_releases",args:{}});
 await act(async()=>button(view,"开发者网站").props.onClick());
 assert.equal(developerCount,1);
});

test("Open Source links are attributed, and legal documents replace content rather than open nested modal",async()=>{
 const {Panel,calls}=setup();
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{desktop:true,onOpenDeveloper:()=>{}}));});
 await act(async()=>button(view,"开源与许可").props.onClick());
 assert.match(textOf(view.root),/ZHS/);
 assert.match(textOf(view.root),/Samueli924\/chaoxing/);
 assert.match(textOf(view.root),/GNU GPL v3 开源许可/);
 assert.equal(view.root.findAllByProps({role:"dialog"}).length,0);
 const link=view.root.findAllByType("a").find(a=>textOf(a).includes("ZHS"));
 assert.equal(link.props.href,"https://github.com/pjm314159/zhs");
 await act(async()=>link.props.onClick({preventDefault(){}}));
 assert.deepEqual(calls.at(-1),{name:"studyflow_open_source_site",args:{kind:"zhs"}});
 await act(async()=>button(view,"GNU GPL v3 开源许可").props.onClick({
  currentTarget:{focus(){}}
 }));
 assert.deepEqual(calls.at(-1),{name:"studyflow_read_document",args:{documentId:"license"}});
 assert.match(textOf(view.root),/许可证原文/);
 assert.match(textOf(view.root),/这里是完整的文档正文/);
 assert.equal(view.root.findAllByProps({role:"dialog"}).length,0);
 await act(async()=>button(view,"返回开源与许可").props.onClick());
 assert.match(textOf(view.root),/使用条款与第三方声明/);
 assert.doesNotMatch(textOf(view.root),/这里是完整的文档正文/);
});

test("invalid legal document payload cannot render a mismatched document",async()=>{
 const {Panel}=setup({documentResult:{id:"terms",title:"错误文档",content:"不应显示"}});
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{desktop:true,onOpenDeveloper:()=>{}}));});
 await act(async()=>button(view,"开源与许可").props.onClick());
 await act(async()=>button(view,"GNU GPL v3 开源许可").props.onClick({
  currentTarget:{focus(){}}
 }));
 assert.match(textOf(view.root),/文档读取失败/);
 assert.doesNotMatch(textOf(view.root),/不应显示/);
});

test("web preview does not access Windows native document commands",async()=>{
 const {Panel,calls}=setup({desktop:false});
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{desktop:false,onOpenDeveloper:()=>{}}));});
 await act(async()=>button(view,"开源与许可").props.onClick());
 assert.match(textOf(view.root),/需要在 Windows 桌面版中读取/);
 for(const item of view.root.findAllByType("button").filter(b=>textOf(b).includes("开源许可")||textOf(b).includes("隐私政策")))
  assert.equal(item.props.disabled,true);
 assert.equal(calls.length,0);
});
