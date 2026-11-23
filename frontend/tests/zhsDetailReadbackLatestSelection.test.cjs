const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"../src/components/ZhsQueuePanel.tsx"),"utf8");

test("late knowledge readback cannot overwrite a newer selection",()=>{
  assert.match(source,/const detailRequestId=useRef\(0\)/);
  assert.match(source,/const requestId=\+\+detailRequestId\.current/);
  const inspect=source.split("async function inspectDetail(",2)[1]?.split("function closeDetail()",1)[0]||"";
  const guards=inspect.match(/requestId!==detailRequestId\.current/g)||[];
  assert.ok(guards.length>=2,"success and error both need latest-request checks");
  assert.match(inspect,/requestId===detailRequestId\.current\)setDetailBusy\(false\)/);
  assert.match(inspect,/scope!==currentDetailScope\.current/);
});

test("dismissing details cancels older readback updates",()=>{
  const close=source.split("function closeDetail()",2)[1]?.split("type Row=",1)[0]||"";
  assert.match(close,/detailRequestId\.current\+\+/);
  assert.match(close,/setDetail\(null\)/);
  assert.match(source,/onClick=\{closeDetail\}>收起详情/);
  assert.match(source,/\[status\.run_id,status\.course_id\]/);
});
