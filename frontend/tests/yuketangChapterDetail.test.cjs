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
   module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020
 }}).outputText;
 const mod={exports:{}};
 new Function("module","exports","require",code)(mod,mod.exports,name=>
   name==="../bridge"?{request,friendlyBridgeError:()=> "读取失败"}:require(name));
 return mod.exports.YuketangCourseDetailPanel;
}
const course={platform:"yuketang",course_id:"123",title:"课程"};

test("selected Rain Classroom auto-reads real videos and groups chapters",async()=>{
 const seen=[];
 const Panel=component(async message=>{
   seen.push(message);
   return [{id:"12",name:"视频一",chapter:"第一章"},{id:"13",name:"视频二",chapter:"第二章"}];
 });
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{
   course,desktop:true,connected:true,scopeDirty:false
 }));});
 const output=JSON.stringify(view.toJSON());
 assert.match(output,/第一章/);
 assert.match(output,/第二章/);
 assert.match(output,/视频一/);
 assert.equal(seen.length,1);
 assert.deepEqual(seen[0],{operation:"videos.list",platform:"yuketang",course_id:"123"});
 act(()=>view.unmount());
});

test("unsaved classroom scope blocks reads and clears old chapter content",async()=>{
 let calls=0;
 const Panel=component(async()=>{
   calls++;return [{id:"12",name:"视频一",chapter:"第一章"}];
 });
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{
   course,desktop:true,connected:true,scopeDirty:false
 }));});
 await act(async()=>{view.update(React.createElement(Panel,{
   course,desktop:true,connected:true,scopeDirty:true
 }));});
 assert.equal(calls,1);
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/视频一/);
 assert.match(JSON.stringify(view.toJSON()),/课堂范围尚未保存/);
 act(()=>view.unmount());
});

test("failed chapter refresh does not preserve previously read videos",async()=>{
 let calls=0;
 const Panel=component(async()=>{
   calls++;if(calls>1)throw Error("offline");
   return [{id:"12",name:"视频一",chapter:"第一章"}];
 });
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{
   course,desktop:true,connected:true,scopeDirty:false
 }));});
 const button=view.root.findAllByType("button")[0];
 await act(async()=>{button.props.onClick();});
 assert.match(JSON.stringify(view.toJSON()),/读取失败/);
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/视频一/);
 act(()=>view.unmount());
});
