const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const official=path.join(root,"frontend/src/components/XuexitongHeartbeatPanel.tsx");
const copy=path.join(root,"integration/frontend/XuexitongHeartbeatPanel.tsx");

test("integration heartbeat panel copy is byte-identical to the shipped component",()=>{
  assert.ok(fs.existsSync(official),"shipped component must exist");
  assert.ok(fs.existsSync(copy),"integration copy must exist");
  assert.deepEqual(fs.readFileSync(copy),fs.readFileSync(official));
});
