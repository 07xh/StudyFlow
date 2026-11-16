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

test("U校园 compares two real server snapshots, never local tick count",()=>{
  const panel=read("components/UCampusHeartbeatPanel.tsx");
  assert.match(panel,/const newlyPassed=previousProgress&&serverProgress/);
  assert.match(panel,/previous\.completed===false/);
  assert.match(panel,/已记录本次服务器状态为基准/);
  assert.match(panel,/不能推断由本地心跳引起/);
});


test("U校园 separates local training from unverified synthetic write status",()=>{
  const local=read("components/UCampusHeartbeatPanel.tsx");
  const synthetic=read("components/UCampusFabricatedPanel.tsx");
  assert.match(local,/本地心跳练习模式/);
  assert.match(local,/仅在本机生成 · 不上传/);
  assert.match(synthetic,/实验性虚构事件模块/);
  assert.match(synthetic,/回读已通过（归因未知）/);
  assert.match(synthetic,/不证明本次事件造成该结果/);
});

test("U校园 synthetic module reports no restart recovery and no causal proof",()=>{
  const panel=read("components/UCampusFabricatedPanel.tsx");
  const bridge=read("bridge.ts");
  assert.match(panel,/重启后自动续跑/);
  assert.match(panel,/状态快照不代表应用重启后能断点续传/);
  assert.match(panel,/发送帧\/尝试次数/);
  assert.match(bridge,/restart_resume_supported:boolean/);
  assert.match(panel,/归因未知/);
});

test("U校园 saved local history is inspectable but does not auto-replay",()=>{
  const panel=read("components/UCampusFabricatedPanel.tsx");
  const bridge=read("bridge.ts");
  assert.match(panel,/ucampus\.fabricated\.history/);
  assert.match(panel,/不会自动续发或补交模拟事件/);
  assert.match(bridge,/UCampusFabricatedHistory/);
});

test("U校园 local exercise shows event progress without claiming watched progress",()=>{
  const panel=read("components/UCampusHeartbeatPanel.tsx");
  const bridge=read("bridge.ts");
  assert.match(panel,/本地模拟事件进度/);
  assert.match(panel,/localTotal=.*targetPerResource/);
  assert.match(panel,/与视频播放、平台学时或课程完成状态无关/);
  assert.match(panel,/aria-label="本地模拟事件进度"/);
  assert.match(panel,/\{task\.generated\}\/\{targetPerResource\}/);
  assert.match(bridge,/pulses_per_resource:number/);
  assert.doesNotMatch(panel,/ucampus\.fabricated\.start/);
});
