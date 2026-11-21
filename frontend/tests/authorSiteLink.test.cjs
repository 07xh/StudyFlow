const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("author blog is only an About link and opens a fixed HTTPS origin", () => {
  const about = fs.readFileSync(path.join(__dirname, "../src/components/ZhidaoAccountTools.tsx"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "../src/ui/AppShell.tsx"), "utf8");
  const rust = fs.readFileSync(path.join(__dirname, "../../src-tauri/src/lib.rs"), "utf8");

  assert.match(about, /view==="about"&&<div className="sf-zd-legal-actions">/);
  assert.match(about, /href="https:\/\/0701000\.xyz\/"/);
  assert.match(about, /开发者网站/);
  assert.match(about, /rel="noopener noreferrer"/);
  assert.match(about, /invoke\("studyflow_open_author_site"\)/);
  assert.doesNotMatch(shell, /0701000\.xyz/);
  assert.match(rust, /fn studyflow_open_author_site\(\) -> Result<\(\), String>/);
  assert.match(rust, /\.arg\("https:\/\/0701000\.xyz\/"\)/);
  assert.match(rust, /studyflow_open_releases, studyflow_open_author_site/);
});
