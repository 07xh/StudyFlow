const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");

const source=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");

function courseWorkspaceBranches(){
  const app=source("App.tsx");
  const start=app.indexOf("const renderCourseWorkspace=");
  const end=app.indexOf("const activeSelectedCourse=",start);
  assert.ok(start>0&&end>start,"Course workspace must exist");
  const file=ts.createSourceFile("CourseWorkspace.tsx",app.slice(start,end),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const branches=[];
  function visit(node){
    if(ts.isConditionalExpression(node)&&
      node.condition.getText(file).replace(/\s+/g,"")==='course.platform==="zhidao"'){
      branches.push({trueBranch:node.whenTrue.getText(file),falseBranch:node.whenFalse.getText(file)});
    }
    ts.forEachChild(node,visit);
  }
  visit(file);
  return branches;
}

test("ZHS runner controls belong to Zhidao course, never Xuexitong",()=>{
  const branches=courseWorkspaceBranches();
  const player=branches.find(item=>item.trueBranch.includes("renderZhidaoModeSwitch"));
  assert.ok(player,"Zhidao playback branch must exist");
  assert.match(player.trueBranch,/<ZhidaoOfficialPlayerPanel/);
  assert.match(player.trueBranch,/<LegacyPlaybackPanel platform="zhidao"/);
  assert.match(player.trueBranch,/hidden=\{mode!=="zhs-original"\}/);
  assert.match(player.falseBranch,/<XuexitongHeartbeatPanel/);
  assert.doesNotMatch(player.falseBranch,/<LegacyPlaybackPanel platform="zhidao"/);
  const legacy=source("components/LegacyPlaybackPanel.tsx");
  assert.match(legacy,/启动原版任务/);
  assert.match(legacy,/停止/);
  assert.match(legacy,/查询运行状态/);
  assert.match(legacy,/<ZhsTaskSettingsPanel/);
});

test("Zhidao server verification stays in Zhidao detail, not Xuexitong",()=>{
  const branches=courseWorkspaceBranches();
  const details=branches.find(item=>item.trueBranch.includes("ZhidaoCourseDetailPanel"));
  assert.ok(details,"Zhidao detail branch must exist");
  assert.match(details.trueBranch,/<ZhidaoProgressPanel/);
  assert.match(details.falseBranch,/<XuexitongCourseDetailPanel/);
  assert.doesNotMatch(details.falseBranch,/<ZhidaoProgressPanel/);
});

test("Yuketang player and Xuexitong task view are isolated",()=>{
  const branches=courseWorkspaceBranches();
  const player=branches.find(item=>item.trueBranch.includes("renderZhidaoModeSwitch"));
  assert.match(player.falseBranch,/<XuexitongHeartbeatPanel/);
  assert.match(player.falseBranch,/<YuketangTaskArea/);
  assert.doesNotMatch(player.trueBranch,/<YuketangTaskArea/);
});
