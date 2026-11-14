const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "src");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("each platform owns its login panel inside its own platform card", () => {
  const app = read("App.tsx");
  const card = read("ui/PlatformCard.tsx");
  assert.match(card, /expanded&&<div className="sf-platform-expanded">[\s\S]*\{children\}/);
  assert.match(app, /definition\.id==="zhidao"[\s\S]*<ZhidaoLoginPanel/);
  assert.match(app, /<YuketangLoginPanel[\s\S]*onSubmit=/);
  assert.match(app, /<PlatformCard[\s\S]*>[\s\S]*<\/PlatformCard>/);
  assert.match(app, /page==="platforms"&&renderPlatforms\(\)/);
  assert.doesNotMatch(app, /page==="platforms"&&<>[\s\S]*<ZhidaoLoginPanel/);
});

test("dashboard uses actual course and server-verified progress, not preview figures", () => {
  const app = read("App.tsx");
  assert.match(app, /course\.progress_evidence==="server_verified"/);
  assert.match(app, /courses\.length/);
  assert.match(app, /averageProgress===null\?"—"/);
  assert.doesNotMatch(app, /62%|8 门|5 门|3 门|\*\*\*\*1234|\*\*\*\*@edu\.cn/);
});

test("LightC-style navigation entries are real StudyFlow pages", () => {
  const shell = read("ui/AppShell.tsx");
  for (const page of ["home","courses","tasks","platforms","records","logs","settings"])
    assert.match(shell, new RegExp('id:"' + page + '"'));
  const app = read("App.tsx");
  for (const page of ["home","courses","tasks","platforms","records","logs","settings"])
    assert.match(app, new RegExp('page==="' + page + '"'));
});

test("Rain Classroom credential inputs are only rendered in its own platform panel", () => {
  const ykt = read("components/YuketangLoginPanel.tsx");
  const app = read("App.tsx");
  assert.match(ykt, /Session ID/);
  assert.match(ykt, /Windows 凭据管理器/);
  assert.match(app, /definition\.id==="zhidao"[\s\S]*: <YuketangLoginPanel/);
  assert.doesNotMatch(app, /雨课堂登录会话[\s\S]*credential-form/);
});
