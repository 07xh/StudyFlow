const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {create,act}=require('react-test-renderer');

function sharedViews(){
 const source=fs.readFileSync(path.join(__dirname,'../src/ui/CourseRecordViews.tsx'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const mod={exports:{}};
 new Function('module','exports','require',code)(mod,mod.exports,require);
 return mod.exports;
}

function component(request){
 const source=fs.readFileSync(path.join(__dirname,'../src/components/ZhidaoCourseDetailPanel.tsx'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const mod={exports:{}};
 new Function('module','exports','require',code)(mod,mod.exports,name=>name==='../bridge'?{request,friendlyBridgeError:()=> 'failed'}:name==='../ui/CourseRecordViews'?sharedViews():require(name));
 return mod.exports.ZhidaoCourseDetailPanel;
}
const course={platform:'zhidao',course_id:'a'.repeat(64),title:'course',course_type:'ai',verified_at:'2026-11-14T12:00:00Z'};
const detail=name=>({course_key:course.course_id,course_type:'ai',verified:true,stale:false,done:0,total:1,items:[{name,progress_percent:50}]});

test('chapter detail follows verification timestamp and clears failed refresh',async()=>{
 let calls=0;
 const Panel=component(async()=>{calls++; if(calls===3)throw Error('offline');return detail('snapshot-'+calls);});
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{course,desktop:true}));});
 assert.match(JSON.stringify(view.toJSON()),/snapshot-1/);
 await act(async()=>{view.update(React.createElement(Panel,{course:{...course,verified_at:'2026-11-14T12:01:00Z'},desktop:true}));});
 assert.equal(calls,2);
 assert.match(JSON.stringify(view.toJSON()),/snapshot-2/);
 await act(async()=>{view.update(React.createElement(Panel,{course:{...course,verified_at:'2026-11-14T12:02:00Z'},desktop:true}));});
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/snapshot-[12]/);
 act(()=>view.unmount());
});

test('clears a selected course when the current session no longer contains it',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/App.tsx'),'utf8');
 assert.match(source,/useEffect\(\(\)=>\{\s*if\(!selectedCourse\)return;\s*if\(!selectedSessionCourse\(courses,selectedCourse\)\)setSelectedCourse\(null\);\s*\},\[courses,selectedCourse\]\);/);
});
