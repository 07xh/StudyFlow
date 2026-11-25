const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const ts=require("typescript");
const read=name=>fs.readFileSync(path.join(__dirname,"../src",name),"utf8");
const context={exports:{},require:name=>{assert.equal(name,"./presentation");return {platformNames:{zhidao:"知到",yuketang:"雨课堂",xuexitong:"学习通",ucampus:"U校园"}};}};
vm.runInNewContext(ts.transpileModule(read("activity.ts"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const {filterActivity}=context.exports;
const rows=[
 {id:"1",platform:"知到",action:"同步课程",detail:"课程A",result:"success",courseId:"abc"},
 {id:"2",platform:"学习通",action:"读取失败",detail:"Network unavailable",result:"warning"},
 {id:"3",platform:"U校园",action:"读取课程",detail:"正常",result:"info"}
];
test("activity filters combine platform, result and trimmed case-insensitive keywords",()=>{
 assert.equal(filterActivity(rows,{platform:"all",result:"warning",query:" NETWORK "})[0].id,"2");
 assert.equal(filterActivity(rows,{platform:"知到",result:"success",query:"ABC"})[0].id,"1");
 assert.equal(filterActivity(rows,{platform:"U校园",result:"warning",query:""}).length,0);
 assert.equal(filterActivity(rows,{platform:"all",result:"all",query:""}).length,3);
 assert.equal(rows.length,3);
});
test("history and logs have independent filters and honest no-match state",()=>{
 const app=read("App.tsx"),views=read("ui/ActivityViews.tsx");
 assert.match(views,/filterActivity\(recordedEvents,recordFilter\)/);
 assert.match(views,/filterActivity\(activity,logFilter\)/);
 assert.match(app,/filter=\{recordFilter\}/);
 assert.match(app,/filter=\{logFilter\}/);
 assert.match(views,/visibleLogs.length===0\?<EmptyState/);
 assert.match(views,/visibleRecords.length===0\?<EmptyState/);
 assert.match(app,/onClear=\{\(\)=>setClearLogsOpen\(true\)\}/);
 assert.match(views,/onClick=\{onClear\}/);
 assert.match(views,/course\.course_id===item\.courseId&&!course\.stale/);
});
test("task center states its monitor scope and does not equate absent monitoring to idle",()=>{
 const panel=read("components/RuntimeTaskList.tsx");
 assert.match(panel,/未接入全局监控不代表没有任务/);
 assert.match(panel,/已接入的监控暂未返回运行任务/);
 assert.match(panel,/aria-busy=\{refreshing\}/);
});
