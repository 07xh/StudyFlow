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

test("U校园 read-only progress panel replaces local practice UI",()=>{
  const app=read("App.tsx");
  const panel=read("components/UCampusProgressVerifyPanel.tsx");
  const synthetic=read("components/UCampusFabricatedPanel.tsx");
  const bridge=read("bridge.ts");
  assert.ok(app.includes("<UCampusProgressVerifyPanel course={course} desktop={desktop}/>"));
  assert.doesNotMatch(app,/UCampusHeartbeatPanel/);
  assert.match(panel,/aria-label="U校园服务器只读核验"/);
  assert.match(panel,/只读 · 不发送学习事件/);
  assert.match(panel,/operation:"ucampus.progress.verify"/);
  assert.match(panel,/operation:"ucampus.units.list"/);
  assert.doesNotMatch(panel,/ucampus\.heartbeat\.(start|pause|resume|stop|status)/);
  assert.doesNotMatch(panel,/ucampus\.fabricated\.(start|pause|resume|stop)/);
  assert.match(panel,/服务器实际记录/);
  assert.match(panel,/previous\.completed===false/);
  assert.match(panel,/已记录本次服务器状态为基准/);
  assert.match(panel,/不能推断由某次本地事件引起/);
  assert.match(panel,/verificationToken\.current/);
  assert.match(bridge,/ucampus\.progress\.verify/);
  assert.match(synthetic,/实验性虚构事件模块/);
  assert.match(synthetic,/回读已通过（归因未知）/);
});
test("U校园 old socket diagnostic remains independent of the progress query",()=>{
  const panel=read("components/UCampusProgressVerifyPanel.tsx");
  assert.match(panel,/ucampus\.socket\.diagnose/);
  assert.match(panel,/只检测旧版 Socket.IO 认证与连接/);
  assert.doesNotMatch(panel,/ucampus\.socket\.send/);
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

test("U校园 read-only UI keeps unit selection and account copy precise",()=>{
  const detail=read("components/UCampusCourseDetailPanel.tsx");
  const login=read("components/UCampusLoginPanel.tsx");
  assert.doesNotMatch(detail,/const selected=units\.find/);
  assert.match(detail,/unit\.title\|\|"单元 "/);
  assert.match(detail,/const normalizedSearch=search\.trim\(\)\.toLowerCase\(\)/);
  assert.doesNotMatch(detail,/search\.toLowerCase\(\)/);
  assert.match(login,/const clearSensitiveInputs=\(\)=>/);
  assert.equal((login.match(/clearSensitiveInputs\(\);/g)||[]).length,2);
  assert.match(login,/>保存会话<\/button>/);
  assert.match(login,/>验证课程读取<\/button>/);
  assert.match(login,/>账号密码登录<\/button>/);
  assert.match(login,/operation:"ucampus.session.login"/);
  assert.match(login,/高级：手动导入现有会话/);
  assert.ok(login.includes('setPassword("");'));

  assert.match(login,/operation:"courses.list",platform:"ucampus"/);
  assert.match(login,/const verifyCatalog=async\(\)/);
  assert.match(login,/const summary=await verifyCatalog\(\)/);
  assert.match(login,/SSO 会话已保存，但课程读取失败/);

  assert.match(login,/尚不能确认该账号已有课程/);
  const bridge=read("bridge.ts");
  for(const code of ["UCAMPUS_CATALOG_UNAVAILABLE","UCAMPUS_CATALOG_FORMAT_UNVERIFIED"]){
    assert.match(bridge,new RegExp(code));
  }
  assert.match(login,/保存成功不表示已登录或接口可用/);
  assert.match(login,/服务器进度只读核验已接入/);
  assert.doesNotMatch(login,/暂不支持课程学习运行与服务器进度/);
});

test("U校园 SSO login uses the same persistent sidecar as session resets",()=>{
  const tauri=fs.readFileSync(path.join(__dirname,"..","..","src-tauri","src","lib.rs"),"utf8");
  assert.match(tauri,/ucampus\.session\.login" \| "ucampus\.session\.configure"/);
  assert.match(tauri,/ucampus\.fabricated\./);
});


test("U校园 read-only progress monitor resumes on app startup and requires opt-in",()=>{
  const app=read("App.tsx");
  const panel=read("components/UCampusProgressVerifyPanel.tsx");
  const bridge=read("bridge.ts");
  const tauri=fs.readFileSync(path.join(__dirname,"..","..","src-tauri","src","lib.rs"),"utf8");
  assert.match(app,/operation:"ucampus.monitor.tick"/);
  assert.match(app,/90_000/);
  assert.match(panel,/operation:"ucampus.monitor.configure",enabled/);
  assert.match(panel,/启用重启后自动核验/);
  assert.match(panel,/不会恢复或补发本地模拟心跳/);
  assert.match(bridge,/UCampusMonitorStatus/);
  assert.match(bridge,/ucampus.monitor.status" \| "ucampus.monitor.tick"/);
  assert.match(tauri,/op.starts_with\("ucampus.monitor."\)/);
});

test("U校园官方扫码入口与 Cookie 导入有明确的会话边界",()=>{
  const login=read("components/UCampusLoginPanel.tsx");
  const style=read("style.css");
  assert.match(login,/https:\/\/sso\.unipus\.cn\/sso\/login/);
  assert.match(login,/https:\/\/uai\.unipus\.cn\//);
  assert.match(login,/系统浏览器登录不能直接同步到学序/);
  assert.match(login,/ucampus_login_window_start/);
  assert.match(login,/ucampus_login_window_import/);
  assert.match(login,/launchEmbedded\("qr"\)/);
  assert.match(login,/>打开二维码登录<\/button>/);
  assert.match(login,/invoke\("ucampus_login_window_import",\{mode:embeddedMode\}\)/);
  assert.match(login,/窗口中尚未检测到 U校园AI 的 JWT/);
  const native=fs.readFileSync(path.join(__dirname,"..","..","src-tauri","src","lib.rs"),"utf8");
  assert.match(native,/UCAMPUS_QR_WINDOW/);
  assert.match(native,/https:\/\/sso\.unipus\.cn\/sso\/login/);
  assert.match(native,/mode: Option<String>/);
  assert.match(native,/spawn_blocking\(move \|\| -> Result<\(\), String>/);

  assert.match(login,/ucampus_login_window_close/);
  assert.match(login,/完成验证，导入并验证会话/);
  assert.match(login,/U校园要求图片或数字验证码/);
  assert.match(login,/error\.message==="UCAMPUS_LOGIN_VERIFICATION_REQUIRED"/);
  assert.match(login,/请在官方页面重新输入账号密码、查看验证码并手动填写/);
  assert.match(login,/扫码属于另一种登录方式，不是短信验证码/);
  assert.doesNotMatch(login,/图形、短信或其他验证/);
  assert.match(read("bridge.ts"),/图片或数字验证码，请在官方登录窗口查看并手动填写/);
  assert.match(login,/className="sf-ucampus-cookie-import">/);
  assert.doesNotMatch(login,/className="sf-ucampus-cookie-import" open/);
  assert.match(login,/cookie:cookie\.trim\(\)\.replace/);
  assert.match(login,/const summary=await verifyCatalog\(\)/);
  assert.match(style,/\.sf-shell \.sf-ucampus-login>details>label\{/);
  assert.match(style,/display:block;max-width:100%/);
  assert.match(style,/\.sf-shell \.sf-ucampus-login input/);
  const rust=fs.readFileSync(path.join(__dirname,"..","..","src-tauri","src","lib.rs"),"utf8");
  assert.match(rust,/\.incognito\(true\)/);
  assert.match(rust,/UCAMPUS_LOGIN_COOKIE_EXPIRED/);
  assert.match(rust,/ucampus_jwt_cookie_expired/);
  assert.match(login,/UCAMPUS_LOGIN_COOKIE_EXPIRED/);
  assert.match(login,/status\.jwt_lifetime==="expired"/);
  assert.match(login,/await refreshStoredExpiry\(\)/);
  assert.match(login,/let windowWarning=""/);
  assert.match(style,/\.sf-shell \.sf-ucampus-session-warning\{/);
});

test("U校园 session saves share exactly one course-readback path",()=>{
  const login=read("components/UCampusLoginPanel.tsx");
  // Official-window import, direct SSO login and manual Cookie import all
  // trigger the same post-save readback with no fabricated connected state.
  assert.equal((login.match(/await completeSessionSave\(/g)||[]).length,3);
  assert.equal((login.match(/await verifyCatalog\(\)/g)||[]).length,2);
  assert.equal((login.match(/invoke\("ucampus_login_window_start",\{mode\}\)/g)||[]).length,1);
  assert.match(login,/const feedback=\{/);
  assert.match(login,/monitorReset===false/);
  assert.match(login,/if\(result\?\.saved!==true\)throw Error\("UCAMPUS_LOGIN_SAVE_FAILED"\)/);
  assert.equal((login.match(/if\(saved\.saved!==true\)throw Error\("UCAMPUS_CREDENTIAL_STORAGE_FAILED"\)/g)||[]).length,2);
  assert.match(login,/if\(method==="official"\)setVariant\("ai"\)/);
  assert.match(login,/error\.message==="UCAMPUS_LOGIN_VERIFICATION_REQUIRED"/);
  assert.doesNotMatch(login,/localStorage\.(?:getItem|setItem)/);
});
