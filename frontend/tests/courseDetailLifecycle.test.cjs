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
const course={platform:'zhidao',course_id:'a'.repeat(64),title:'course',course_type:'ai',verified_at:new Date().toISOString()};
const detail=name=>({course_key:course.course_id,course_type:'ai',verified:true,stale:false,done:0,total:1,verified_at:new Date().toISOString(),items:[{name,progress_percent:50}]});

test('chapter detail follows verification timestamp and clears failed refresh',async()=>{
 let calls=0;
 const Panel=component(async()=>{calls++; if(calls===3)throw Error('offline');return detail('snapshot-'+calls);});
 let view;
 await act(async()=>{view=create(React.createElement(Panel,{course,desktop:true}));});
 assert.match(JSON.stringify(view.toJSON()),/snapshot-1/);
 await act(async()=>{view.update(React.createElement(Panel,{course:{...course,verified_at:new Date(Date.now()+1000).toISOString()},desktop:true}));});
 assert.equal(calls,2);
 assert.match(JSON.stringify(view.toJSON()),/snapshot-2/);
 await act(async()=>{view.update(React.createElement(Panel,{course:{...course,verified_at:new Date(Date.now()+2000).toISOString()},desktop:true}));});
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
  verified_at:new Date().toISOString(),items:[{name:'已完成知识点',fully_progressed:true}]
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
    verified_at:new Date().toISOString(),items:[{name:'新课程知识点',progress_percent:45}]};
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

test('overnight verified chapter cache is refreshed with one real server read',async()=>{
 const old='2025-01-01T00:00:00Z',calls=[],updates=[];
 let fresh=false;
 const Panel=component(async args=>{
  calls.push(args.operation);
  if(args.operation==='zhidao.progress.verify'){
   fresh=true;
   return {courses:[{...course,progress_evidence:'server_verified',
     verified_at:new Date().toISOString(),progress_percent:42,stale:false}],
     incomplete:false,fetched_at:null};
  }
  if(args.operation==='zhidao.course.detail')
   return {...detail(fresh?'服务器最新章节':'昨日历史章节'),
     verified_at:fresh?new Date().toISOString():old};
  throw Error('unexpected operation');
 });
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{
   course:{...course,verified_at:old},desktop:true,
   onCoursesUpdated:rows=>updates.push(rows)
  }));});
  assert.deepEqual(calls,[
   'zhidao.course.detail','zhidao.progress.verify','zhidao.course.detail']);
  assert.equal(updates.length,1);
  assert.match(JSON.stringify(view.toJSON()),/服务器最新章节/);
 }finally{if(view)act(()=>view.unmount());}
});

test('app-level automatic verifier owns the read when already enabled',async()=>{
 const old='2025-01-01T00:00:00Z',calls=[];
 const Panel=component(async args=>{
  calls.push(args.operation);
  if(args.operation!=='zhidao.course.detail')throw Error('duplicate verification');
  return {...detail('昨日历史章节'),verified_at:old};
 });
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{
   course:{...course,verified_at:old},desktop:true,autoVerifyActive:true
  }));});
  assert.deepEqual(calls,['zhidao.course.detail']);
  assert.match(JSON.stringify(view.toJSON()),/昨日历史章节/);
 }finally{if(view)act(()=>view.unmount());}
});

test('Zhidao chapter groups start collapsed and preserve explicit toggles across filters',async()=>{
 const Panel=component(async()=>({
  ...detail('unused'),total:3,items:[
   {name:'第一章知识点',chapter_name:'第一章',progress_percent:50},
   {name:'绪论知识点',chapter_name:'绪论',progress_percent:50},
   {name:'第二章知识点',chapter_name:'第二章',progress_percent:50}
  ]
 }));
 let view;
 try{
  await act(async()=>{view=create(React.createElement(Panel,{course,desktop:true}));});
  const chapter=name=>view.root.findAllByType('button').find(button=>
   button.props.className==='sf-ykt-chapter-toggle'&&
   button.findAllByType('strong').some(node=>node.props.children===name));
  for(const name of ['绪论','第一章','第二章'])
   assert.equal(chapter(name).props['aria-expanded'],false);
  act(()=>chapter('绪论').props.onClick());
  assert.equal(chapter('绪论').props['aria-expanded'],true);
  const filter=view.root.findAllByType('select').find(node=>node.props['aria-label']==='章节筛选');
  act(()=>filter.props.onChange({target:{value:'第一章'}}));
  assert.equal(chapter('第一章').props['aria-expanded'],false);
  act(()=>filter.props.onChange({target:{value:''}}));
  assert.equal(chapter('绪论').props['aria-expanded'],true);
  act(()=>chapter('绪论').props.onClick());
  assert.equal(chapter('绪论').props['aria-expanded'],false);
  const buttons=view.root.findAllByType('button');
  act(()=>buttons.find(button=>button.props.children==='展开全部').props.onClick());
  for(const name of ['绪论','第一章','第二章'])
   assert.equal(chapter(name).props['aria-expanded'],true);
  act(()=>view.root.findAllByType('button').find(button=>button.props.children==='收起全部').props.onClick());
  for(const name of ['绪论','第一章','第二章'])
   assert.equal(chapter(name).props['aria-expanded'],false);
 }finally{if(view)act(()=>view.unmount());}
});
