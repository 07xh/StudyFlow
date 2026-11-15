const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=p=>fs.readFileSync(path.join(__dirname,"..","src",p),"utf8");

test("Zhidao automatic read-only verification is owned by app, not the unmounted panel",()=>{
 const panel=source("components/ZhidaoProgressPanel.tsx");
 const app=source("App.tsx");
 const monitor=source("zhidaoAutoVerify.ts");
 const bridge=source("bridge.ts");
 assert.match(panel,/zhidao\.progress\.sync/);
 assert.match(panel,/zhidao\.progress\.verify/);
 assert.doesNotMatch(panel,/setInterval|lastAutomaticCheck/);
 assert.match(panel,/onAutoVerifyChange\(selected,checked\)/);
 assert.match(app,/useZhidaoAutoVerify\(/);
 assert.match(app,/function inspectCourse\(course:Course\)/);
 assert.match(app,/onAutoVerifyChange=\{configureAutoVerify\}/);
 assert.match(app,/preferences\[course\.course_id\]\?\?true/);
 assert.match(monitor,/window\.setInterval\(check,120000\)/);
 assert.match(monitor,/window\.clearInterval\(timer\)/);
 assert.match(monitor,/window\.addEventListener\("focus",check\)/);
 assert.match(monitor,/now-lastAttempt\.current\.at<60000/);
 assert.match(monitor,/inFlight\.current/);
 assert.match(monitor,/active=false/);
 assert.match(monitor,/operation:"zhidao\.progress\.verify"/);
 assert.doesNotMatch(monitor,/saveDatabaseIntervalTimeV2|studyRecord\/report|generateHeartbeat/);
 assert.match(bridge,/course_key: string/);
});

test("chapter record filters only the current course's verified server rows",()=>{
 const detail=source("components/ZhidaoCourseDetailPanel.tsx");
 assert.match(detail,/type StatusFilter="all"\|"incomplete"\|"completed"\|"unverified"/);
 assert.match(detail,/detail\?\.course_key===course\.course_id/);
 assert.match(detail,/lessonStatus\(item,kind\)===statusFilter/);
 assert.match(detail,/chapterOf\(item\)===chapterFilter/);
 const shared=source("ui/CourseRecordViews.tsx");
 assert.match(shared,/type="search"/);
 assert.match(detail,/CourseRecordToolbar/);
 assert.match(detail,/CourseChapterGroup/);
 assert.match(shared,/aria-expanded=\{expanded\}/);
 assert.match(detail,/没有符合当前筛选条件的学习记录/);
 assert.match(detail,/id:"unverified"/);
 assert.match(detail,/server_completed===false/);
 assert.match(detail,/fully_progressed===true/);
});

test("verified percentages are labeled by their actual evidence type",()=>{
 const presentation=source("presentation.ts");
 const card=source("ui/CourseCard.tsx");
 assert.match(presentation,/满进度知识点占比/);
 assert.match(presentation,/已完成视频占比/);
 assert.match(card,/course\.course_type==="ai"/);
});

test("Zhidao and Rain Classroom reuse the same course record components and preserve evidence",()=>{
 const zd=source("components/ZhidaoCourseDetailPanel.tsx");
 const ykt=source("components/YuketangCourseDetailPanel.tsx");
 const shared=source("ui/CourseRecordViews.tsx");
 assert.match(zd,/sf-unified-records/);
 assert.match(ykt,/sf-unified-records/);
 for(const body of [zd,ykt]){
   assert.match(body,/CourseRecordToolbar/);
   assert.match(body,/CourseChapterGroup/);
   assert.match(body,/onExpandAll/);
 }
 assert.match(zd,/currentDetail\?\.stale/);
 assert.match(ykt,/progress_percent===null/);
 assert.match(shared,/搜索学习记录/);
 assert.match(shared,/aria-label="章节筛选"/);
});
