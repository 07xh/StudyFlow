const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");

test("platform sidebar has separate pages and platform-owned login components",()=>{
  const app=read("App.tsx"),shell=read("ui/AppShell.tsx");
  const card=read("ui/PlatformCard.tsx");
  assert.match(shell,/platformNavigation/);
  assert.match(shell,/id:"platform-zhidao"/);
  assert.match(shell,/id:"platform-yuketang"/);
  assert.match(app,/if\(platform==="zhidao"\)return <ZhidaoLoginPanel/);
  assert.match(app,/if\(platform==="yuketang"\)return <YuketangLoginPanel/);
  assert.match(app,/page==="platform-zhidao"&&renderPlatformDetail\("zhidao"\)/);
  assert.match(app,/page==="platform-yuketang"&&renderPlatformDetail\("yuketang"\)/);
  assert.match(app,/onToggleLogin=\{\(\)=>goPlatform\(definition\.id\)\}/);
  assert.match(card,/expanded&&<div className="sf-platform-expanded">[\s\S]*\{children\}/);
});

test("playback configuration belongs to the individual platform page",()=>{
  const app=read("App.tsx"),legacy=read("components/LegacyPlaybackPanel.tsx");
  assert.match(app,/const renderPlatformDetail=\(platform:Platform\)=>/);
  assert.match(app,/<LegacyPlaybackPanel platform=\{platform\}/);
  assert.match(app,/查看任务与参数/);
  assert.match(legacy,/validateOriginalOptions/);
  assert.match(legacy,/max_concurrent_videos/);
  assert.doesNotMatch(app,/page==="tasks"&&[\s\S]*<LegacyPlaybackPanel platform="zhidao"/);
});

test("course status is always based on real evidence",()=>{
  const app=read("App.tsx");
  assert.match(app,/course\.progress_evidence==="server_verified"/);
  assert.match(app,/courses\.length/);
  assert.match(app,/averageProgress===null\?"—"/);
  assert.doesNotMatch(app,/62%|8 门|5 门|3 门|\*\*\*\*1234/);
});

test("Yuketang credentials remain in its own panel only",()=>{
  const app=read("App.tsx"),ykt=read("components/YuketangLoginPanel.tsx");
  assert.match(ykt,/Session ID/);
  assert.match(ykt,/Windows 凭据管理器/);
  assert.match(app,/if\(platform==="yuketang"\)return <YuketangLoginPanel/);
  assert.doesNotMatch(app,/雨课堂登录会话[\s\S]*credential-form/);
});
