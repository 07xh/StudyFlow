const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {create,act}=require('react-test-renderer');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
function evaluate(code,resolve){const mod={exports:{}};new Function('module','exports','require',code)(mod,mod.exports,resolve);return mod.exports;}

test('navigation preserves valid selection without leaking its heading to another platform, and invalidation clears it',async()=>{
 const oldWindow=global.window;
 const store=new Map();
 global.window={localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
 const course={platform:'zhidao',course_id:'test-course',title:'test course',progress_percent:25,progress_evidence:'server_verified',verified_at:'2026-11-14T12:00:00Z',course_type:'shared'};
 const yuketangCourse={platform:'yuketang',course_id:'ykt-course',title:'other platform course',progress_percent:null};
 let shell,detail,view;
 const Null=()=>null;
 const presentation=evaluate(compile('presentation.ts'),require);
 const App=evaluate(compile('App.tsx'),name=>{
  if(name==='./platforms')return {initialPlatforms:{zhidao:{platform:'zhidao',status:'connected',courses:[course]},yuketang:{platform:'yuketang',status:'connected',courses:[yuketangCourse]},xuexitong:{platform:'xuexitong',status:'not_connected',courses:[]},ucampus:{platform:'ucampus',status:'not_connected',courses:[]}}};
  if(name==='./presentation')return presentation;
  if(name==='./activity')return require('./helpers/load.cjs')('activity.ts');
  if(name==='./runtimeTasks')return require('./helpers/load.cjs')('runtimeTasks.ts');
  if(name==='./bridge')return {isDesktop:()=>false,friendlyBridgeError:String,request:async()=>({})};
  if(name==='./ui/registry')return {platformRegistry:[{id:'zhidao',name:'知到'},{id:'yuketang',name:'雨课堂'},{id:'xuexitong',name:'学习通'},{id:'ucampus',name:'U校园'}],platformInfo:id=>({id,name:id==='zhidao'?'知到':id==='yuketang'?'雨课堂':'学习通'})};
  if(name==='./ui/useAppearance')return {useAppearance:()=>({dark:false,mode:'light',setMode:()=>{},toggleTheme:()=>{}})};
  if(name==='./useReleaseChangelog')return {useReleaseChangelog:()=>({dialog:null,close:()=>{},openHistory:()=>{}})};
  if(name==='./ui/AppShell')return {AppShell:props=>{shell=props;return props.children;}};
  if(name==='./ui/CourseCard')return {CourseCard:props=>React.createElement('button',{'data-select-course':true,'data-course-id':props.course.course_id,onClick:()=>props.onInspect(props.course)})};
  if(name==='./components/YuketangCourseDetailPanel')return {
    YuketangCourseDetailPanel:Null,
    resetYuketangVerification:()=>{},
    verifyYuketangPlayedVideo:async()=>false,
    verifyYuketangCourse:async()=>{},
    getYuketangVideoSummary:()=>null,
    subscribeYuketangVerification:()=>()=>{},
    getYuketangVerificationRevision:()=>0
  };
  if(name==='./ui/CollapsibleSection')return {CollapsibleSection:props=>props.children};
  if(name==='./components/ZhidaoCourseDetailPanel')return {ZhidaoCourseDetailPanel:props=>{detail=props;return null;}};
  if(name==='lucide-react')return new Proxy({},{get:()=>Null});
  if(name.startsWith('./'))return new Proxy({default:Null},{get:(target,key)=>target[key]??Null});
  return require(name);
 }).default;
 try{
  await act(async()=>{view=create(React.createElement(App));});
  act(()=>shell.onNavigate('platform-zhidao'));
  assert.deepEqual(view.root.findAllByProps({'data-select-course':true}).map(node=>node.props['data-course-id']),['test-course']);
  act(()=>view.root.findByProps({'data-select-course':true}).props.onClick());
  assert.equal(shell.currentCourseTitle,'test course');
  assert.equal(shell.courseProgress,25);
  act(()=>shell.onOpenSettings());
  assert.equal(shell.currentCourseTitle,'test course','Opening settings must preserve the current course');
  assert.equal(shell.courseProgress,25,'Opening settings must preserve verified progress');
  act(()=>shell.onNavigate('platform-yuketang'));
  assert.equal(shell.currentPlatform,'雨课堂');
  assert.equal(shell.currentCourseTitle,undefined);
  assert.deepEqual(view.root.findAllByProps({'data-select-course':true}).map(node=>node.props['data-course-id']),['ykt-course']);
  act(()=>shell.onNavigate('platform-xuexitong'));
  assert.equal(shell.currentPlatform,'学习通');
  assert.equal(shell.currentCourseTitle,undefined);
  act(()=>shell.onNavigate('platform-zhidao'));
  assert.equal(shell.currentCourseTitle,undefined);
  assert.deepEqual(view.root.findAllByProps({'data-select-course':true}).map(node=>node.props['data-course-id']),['test-course']);
  act(()=>view.root.findByProps({'data-select-course':true}).props.onClick());
  assert.equal(shell.currentCourseTitle,'test course');
  act(()=>detail.onCoursesUpdated([]));
  assert.equal(shell.currentCourseTitle,undefined);
  assert.equal(shell.courseProgress,null);
 }finally{
  if(view)act(()=>view.unmount());
  if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
 }
});
