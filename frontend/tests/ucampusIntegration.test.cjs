const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,"..","src",name),"utf8");

test("U校园 is registered as a separate fourth platform",()=>{
  const registry=read("ui/registry.ts");
  const shell=read("ui/AppShell.tsx");
  const bridge=read("bridge.ts");
  assert.match(registry,/id:"ucampus"/);
  assert.match(shell,/id:"platform-ucampus"/);
  assert.match(bridge,/result.size !== 4/);
  assert.match(bridge,/ucampus\.session\.configure/);
});
test("U校园 reads no invented courses or progress",()=>{
  const app=read("App.tsx");
  const login=read("components/UCampusLoginPanel.tsx");
  assert.match(app,/renderPlatformDetail\("ucampus"\)/);
  assert.match(app,/<UCampusCourseDetailPanel course=\\{course\\} desktop=\\{desktop\\}\\/>/);
  const detail=read("components/UCampusCourseDetailPanel.tsx");
  assert.match(detail,/ucampus\\.units\\.list/);
  assert.match(detail,/ucampus\\.unit\\.tasks/);
  assert.match(detail,/待核验/);
  assert.doesNotMatch(detail,/Math\\.random\\(\\)|fakeCourse|demoCourse/);
  assert.match(login,/type="password"/);
  assert.doesNotMatch(login,/localStorage\.(?:getItem|setItem)/);
  assert.doesNotMatch(login,/demoCourse|fakeCourse/);
});
