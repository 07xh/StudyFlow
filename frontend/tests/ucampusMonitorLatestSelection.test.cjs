const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../src/components/UCampusProgressVerifyPanel.tsx"),"utf8");

test("read-only monitor uses separate request token and account/course scope",()=>{
  assert.match(source,/const monitorToken=useRef\(0\)/);
  assert.match(source,/const monitorScope=useRef\(""/);
  assert.match(source,/monitorScope\.current=JSON\.stringify\(\[courseId,unitId\]\)/);
  assert.match(source,/monitorToken\.current\+\+/);
  assert.match(source,/initialMonitorToken===monitorToken\.current/);
});

test("late monitor configuration or first status cannot overwrite new selection",()=>{
  const body=source.split("async function toggleMonitor()",2)[1]?.split("function refreshMonitorStatus()",1)[0]||"";
  assert.match(body,/const token=\+\+monitorToken\.current/);
  assert.match(body,/const stillCurrent=/);
  assert.ok((body.match(/if\(!stillCurrent\(\)\)return;/g)||[]).length>=2,
    "both configuration and initial GET must check their scope");
  assert.match(body,/finally\{if\(stillCurrent\(\)\)setMonitorBusy\(false\)/);
});

test("manual monitor status read and unit changes invalidate older UI results",()=>{
  assert.match(source,/onClick=\{refreshMonitorStatus\}/);
  assert.match(source,/if\(token===monitorToken\.current&&scope===monitorScope\.current\)setMonitor\(value\)/);
  assert.match(source,/verificationToken\.current\+\+;monitorToken\.current\+\+/);
});
