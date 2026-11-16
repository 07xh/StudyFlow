const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../src");
const app=fs.readFileSync(path.join(root,"App.tsx"),"utf8");
const chapters=fs.readFileSync(path.join(root,"components/XuexitongPanels.tsx"),"utf8");

test("Xuexitong controls mount once in the shared course playback stage",()=>{
  assert.match(app,/import \{XuexitongHeartbeatPanel\} from "\.\/components\/XuexitongHeartbeatPanel"/);
  assert.match(app,/<XuexitongHeartbeatPanel course=\{course\} desktop=\{desktop\}\/>/);
  assert.doesNotMatch(chapters,/<XuexitongHeartbeatPanel\b/);
  assert.doesNotMatch(app,/执行器未接入统一控制前/);
  assert.doesNotMatch(chapters,/心跳执行模块由你自行接入/);
});
