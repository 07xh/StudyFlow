const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/load.cjs');
test('course history excludes other courses, other platforms and unscoped legacy events',()=>{
 const {courseEvents}=load('activity.ts');
 const events=[{id:'a',platform:'知到',courseId:'A'},{id:'b',platform:'知到',courseId:'B'},{id:'old',platform:'知到'},{id:'other',platform:'雨课堂',courseId:'A'}];
 assert.deepEqual(courseEvents(events,'zhidao','A').map(e=>e.id),['a']);
});
test('metric retains actual denominator and hides stale percentages',()=>{
 const {courseMetric}=load('presentation.ts');
 const c={course_type:'ai',progress_percent:40,progress_evidence:'server_verified',verified_at:'2026-11-14T12:00:00Z'};
 assert.equal(courseMetric(c).label,'满进度知识点占比');
 assert.equal(courseMetric({...c,course_type:'shared'}).label,'已完成视频占比');
 assert.equal(courseMetric({...c,stale:true}).percent,null);
});
