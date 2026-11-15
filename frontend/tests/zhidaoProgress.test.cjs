const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=p=>fs.readFileSync(path.join(__dirname,"..","src",p),"utf8");

test("Zhidao progress uses read-only bridge operations and defaults to live course verification",()=>{
 const panel=source("components/ZhidaoProgressPanel.tsx");
 const bridge=source("bridge.ts");
 assert.match(panel,/zhidao\.progress\.sync/);
 assert.match(panel,/zhidao\.progress\.verify/);
 assert.match(panel,/120000/);
 assert.match(panel,/useState\(detailMode\)/);
 assert.match(panel,/lastAutomaticCheck/);
 assert.match(panel,/window\.addEventListener\?\.\("focus",check\)/);
 assert.match(panel,/服务器进度暂未更新/);
 assert.match(bridge,/course_key: string/);
});

test("verified percentages are labeled by their actual evidence type",()=>{
 const presentation=source("presentation.ts");
 const card=source("ui/CourseCard.tsx");
 assert.match(presentation,/满进度知识点占比/);
 assert.match(presentation,/已完成视频占比/);
 assert.match(card,/course\.course_type==="ai"/);
});
