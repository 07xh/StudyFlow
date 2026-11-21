const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("ZHS-only detail links require live course and knowledge verification",()=>{
  const rust=fs.readFileSync(path.join(__dirname,"../../src-tauri/src/lib.rs"),"utf8");
  const panel=fs.readFileSync(path.join(__dirname,"../src/components/ZhsQueuePanel.tsx"),"utf8");
  assert.match(rust,/async fn zhidao_zhs_open_knowledge\(/);
  assert.match(rust,/operation": "zhidao\.player\.target"/);
  assert.match(rust,/operation": "zhidao\.zhs\.knowledge\.detail"/);
  assert.match(rust,/https:\/\/ai-smart-course-student-pro\.zhihuishu\.com\/learnPage/);
  assert.match(panel,/invoke\("zhidao_zhs_open_knowledge"/);
  assert.match(panel,/在知到官网实际学习此知识点/);
  assert.match(panel,/核验服务器进度/);
  assert.match(panel,/服务器学习进度没有增加/);
  assert.doesNotMatch(panel,/saveStudentPointLog|studyRecord\/completed/);
});
