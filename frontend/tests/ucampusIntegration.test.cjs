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
test("U校园 reads only supported task and server status",()=>{
  const app=read("App.tsx");
  const login=read("components/UCampusLoginPanel.tsx");
  const detail=read("components/UCampusCourseDetailPanel.tsx");
  assert.match(app,/renderPlatformDetail\("ucampus"\)/);
  assert.ok(app.includes("<UCampusCourseDetailPanel course={course} desktop={desktop}/>"));
  assert.ok(detail.includes('operation:"ucampus.units.list"'));
  assert.ok(detail.includes('operation:"ucampus.unit.tasks"'));
  assert.match(detail,/待核验/);
  assert.doesNotMatch(detail,/Math\.random\(\)|fakeCourse|demoCourse/);
  assert.match(login,/type="password"/);
  assert.doesNotMatch(login,/localStorage\.(?:getItem|setItem)/);
  assert.doesNotMatch(login,/demoCourse|fakeCourse/);
});

test("U校园 local heartbeat is independent of official player",()=>{
  const app=read("App.tsx");
  const panel=read("components/UCampusHeartbeatPanel.tsx");
  assert.ok(app.includes("<UCampusHeartbeatPanel course={course} desktop={desktop}/>"));
  assert.ok(panel.includes('operation:"ucampus.heartbeat.start"'));
  assert.match(panel,/本地已生成/);
  assert.match(panel,/实际发送/);
  assert.match(panel,/平台确认/);
  assert.doesNotMatch(panel,/ZhidaoOfficialPlayerPanel|LegacyPlaybackPanel/);
});

test("U校园 legacy socket diagnostic cannot send learning events",()=>{
  const panel=read("components/UCampusHeartbeatPanel.tsx");
  const bridge=read("bridge.ts");
  assert.match(panel,/ucampus\.socket\.diagnose/);
  assert.match(panel,/仅检查旧版 Socket.IO 连接和认证，不发送学习心跳/);
  assert.match(bridge,/operation: "ucampus\.socket\.diagnose"/);
  assert.doesNotMatch(panel,/ucampus\.socket\.send/);
});

test("U校园 verifies server progress separately from local event counters",()=>{
  const panel=read("components/UCampusHeartbeatPanel.tsx");
  const bridge=read("bridge.ts");
  assert.ok(panel.includes('operation:"ucampus.progress.verify"'));
  assert.match(panel,/服务器实际记录/);
  assert.match(panel,/与本地心跳计数无关/);
  assert.match(bridge,/ucampus\.progress\.verify/);
});
