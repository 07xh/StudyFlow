const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=file=>fs.readFileSync(path.join(__dirname,"../src",file),"utf8");

test("developer website has its own in-app introduction and one external entry",()=>{
  const panel=source("ui/DeveloperSitePanel.tsx");
  const modal=source("ui/GlobalSettingsModal.tsx");
  const about=source("ui/AboutOpenSourcePanel.tsx");
  const account=source("components/ZhidaoAccountTools.tsx");
  const app=source("App.tsx");
  const rust=fs.readFileSync(path.join(__dirname,"../../src-tauri/src/lib.rs"),"utf8");

  assert.match(modal, /id:"developer" as const,label:"开发者网站"/);
  assert.match(app, /globalSettingsTab==="developer"&&<DeveloperSitePanel desktop=\{desktop\}/);
  assert.match(panel, /aria-label="开发者网站介绍"/);
  assert.match(panel, /访问开发者网站/);
  assert.match(panel, /href=\{AUTHOR_SITE_URL\}/);
  assert.match(panel, /rel="noopener noreferrer"/);
  assert.match(panel, /invoke\("studyflow_open_author_site"\)/);
  assert.match(panel, /https:\/\/0701000\.xyz\//);
  assert.doesNotMatch(account, /0701000\.xyz|studyflow_open_author_site|开发者网站/);
  assert.doesNotMatch(about, /https:\/\/0701000\.xyz\//);
  assert.match(about, /onOpenDeveloper/);
  assert.match(about, /产品概览/);
  assert.match(rust, /fn studyflow_open_author_site\(\) -> Result<\(\), String>/);
  assert.match(rust, /\.arg\("https:\/\/0701000\.xyz\/"\)/);
  assert.match(rust, /studyflow_open_releases, studyflow_open_author_site/);
});
