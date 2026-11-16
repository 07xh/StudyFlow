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

test('Zhidao full-knowledge flag is not mislabeled unverified when percent is absent',async()=>{
 const Panel=component(async()=>({
  course_key:course.course_id,course_type:'ai',verified:true,stale:false,done:1,total:1,
  items:[{name:'已完成知识点',fully_progressed:true}]
 }));
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{course,desktop:true}));});
 const status=view.root.findAllByType('span').find(node=>
  String(node.props.className||'').includes('sf-record-status'));
 assert.ok(status);
 assert.equal(status.props.children,'已达满进度');
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/0.0%/);
 act(()=>view.unmount());
});

test('switching to a course with no cached chapters triggers real single-course verification',async()=>{
 const key='b'.repeat(64),calls=[],updates=[];
 let verified=false;
 const Panel=component(async args=>{
  calls.push(args.operation+':'+args.course_key);
  if(args.operation==='zhidao.progress.verify'){
   verified=true;
   return {courses:[{platform:'zhidao',course_id:key,progress_evidence:'server_verified',
     progress_percent:16,verified_at:'2026-11-16T13:00:00Z'}],incomplete:false,fetched_at:null};
  }
  if(args.operation==='zhidao.course.detail')return {
   course_key:key,course_type:'ai',verified,stale:false,done:verified?1:0,
   total:verified?1:0,items:verified?[{name:'从服务器回读的知识点',progress_percent:100}]:[]
  };
  throw Error('unexpected operation');
 });
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{
   course:{...course,course_id:key,verified_at:null},desktop:true,
   onCoursesUpdated:list=>updates.push(list)
  }));});
  assert.deepEqual(calls,[
   'zhidao.course.detail:'+key,'zhidao.progress.verify:'+key,
   'zhidao.course.detail:'+key]);
  assert.match(JSON.stringify(view.toJSON()),/从服务器回读的知识点/);
  assert.equal(updates.length,1);
 }finally{if(view)act(()=>view.unmount());}
});

test('manual chapter refresh verifies current server state instead of reading cache alone',async()=>{
 const calls=[];
 const Panel=component(async args=>{
  calls.push(args.operation);
  if(args.operation==='zhidao.progress.verify')
    return {courses:[{...course,stale:false}],incomplete:false,fetched_at:null};
  return detail('actual');
 });
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{course,desktop:true}));});
  const button=view.root.findAllByType('button').find(x=>
   Array.isArray(x.props.children)&&
   x.props.children.some(child=>typeof child==='string'&&child.includes('刷新章节')));
  assert.ok(button);
  await act(async()=>{button.props.onClick();});
  assert.deepEqual(calls,['zhidao.course.detail','zhidao.course.detail',
   'zhidao.progress.verify','zhidao.course.detail']);
 }finally{if(view)act(()=>view.unmount());}
});

test('a delayed previous-course response never overwrites the newly selected course',async()=>{
 const oldKey='a'.repeat(64),newKey='b'.repeat(64);
 let releaseOld;
 const Panel=component(async args=>{
  if(args.course_key===oldKey)return new Promise(resolve=>{releaseOld=resolve;});
  return {course_key:newKey,course_type:'ai',verified:true,stale:false,done:0,total:1,
    items:[{name:'新课程知识点',progress_percent:45}]};
 });
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{course,desktop:true}));});
  await act(async()=>{view.update(React.createElement(Panel,{
   course:{...course,course_id:newKey,title:'new'},desktop:true
  }));});
  assert.match(JSON.stringify(view.toJSON()),/新课程知识点/);
  await act(async()=>{releaseOld(detail('旧课程知识点'));});
  const rendered=JSON.stringify(view.toJSON());
  assert.match(rendered,/新课程知识点/);
  assert.doesNotMatch(rendered,/旧课程知识点/);
 }finally{if(view)act(()=>view.unmount());}
});
