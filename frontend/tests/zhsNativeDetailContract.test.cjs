const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("ZHS detail workflow remains native and cannot redirect to browser playback", () => {
  const rust=fs.readFileSync(path.join(__dirname,"../../src-tauri/src/lib.rs"),"utf8");
  const panel=fs.readFileSync(path.join(__dirname,"../src/components/ZhsQueuePanel.tsx"),"utf8");
  const python=fs.readFileSync(path.join(__dirname,"../../src/studyflow/services/zhs_queue.py"),"utf8");
  assert.doesNotMatch(rust,/zhidao_zhs_open_knowledge|zhs_knowledge_learning_url/);
  assert.doesNotMatch(panel,/openOfficialKnowledge|zhidao_zhs_open_knowledge|在知到官网实际学习/);
  assert.match(panel,/operation:"zhidao.zhs.knowledge.detail"/);
  assert.match(panel,/核验服务器进度/);
  assert.match(python,/if t.kind == "detail"/);
  assert.match(python,/t.detail_evidence != "catalog_empty"/);
  assert.match(python,/enter_knowledge_once/);
  assert.doesNotMatch(python,/saveStudentPointLog|\/studyRecord\/completed/);
});
