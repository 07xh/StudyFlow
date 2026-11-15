const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const load=require('./helpers/load.cjs');
const {ZhidaoProgressPanel}=load('components/ZhidaoProgressPanel.tsx');
const props={desktop:false,connected:false,onCoursesUpdated:()=>{},autoVerifyCourseId:'',autoVerifyEnabled:false,onAutoVerifyChange:()=>{}};
const course={platform:'zhidao',course_id:'test-evidence',title:'Evidence fixture',course_type:'ai',progress_percent:6,progress_metric:'official_ai_schedule',stale:false};
test('verification bar only displays progress backed by server evidence',()=>{
 let view;
 try{
  act(()=>{view=create(React.createElement(ZhidaoProgressPanel,{...props,courses:[course]}));});
  assert.equal(view.root.findAllByType('progress').length,0,'An unverified number cannot become a progress bar');
  act(()=>view.update(React.createElement(ZhidaoProgressPanel,{...props,courses:[{...course,progress_evidence:'server_verified',verified_at:'2026-11-15T12:00:00Z'}]})));
  const bar=view.root.findByType('progress');
  assert.equal(bar.props.value,6);assert.equal(bar.props.max,100);
  act(()=>view.update(React.createElement(ZhidaoProgressPanel,{...props,courses:[{...course,stale:true,progress_evidence:'server_verified',verified_at:'2026-11-15T12:00:00Z'}]})));
  assert.equal(view.root.findAllByType('progress').length,0,'Stale cache cannot display current verified progress');
 }finally{if(view)act(()=>view.unmount());}
});
