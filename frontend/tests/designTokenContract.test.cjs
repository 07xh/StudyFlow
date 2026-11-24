const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,"../src",name),"utf8");
const css=read("ui/foundation.css");
test("dark palette has one shared source and light palette remains explicit",()=>{
 const common=css.match(/\.app\.sf-shell,\.app\.sf-shell\.dark\{([^}]+)\}/)?.[1];
 const light=css.match(/\.app\.sf-shell:not\(\.dark\)\{([^}]+)\}/)?.[1];
 assert.ok(common&&light);
 for(const key of ["bg","panel","panel-raised","text","muted","line","side","accent","accent-strong","accent-text","soft-accent","subtle","success","success-bg","warning","warning-bg","soft-shadow"]){
  assert.ok(common.includes("--"+key+":"));
  assert.ok(light.includes("--"+key+":"));
 }
 assert.match(css,/\.app\.sf-shell\.dark\{color-scheme:dark\}/);
 assert.match(light,/color-scheme:light/);
});
test("common control and focus dimensions are shared by settings and catalog surfaces",()=>{
 for(const [key,value] of [["icon-control-size","32px"],["control-height","35px"],["control-radius","10px"],["filter-height","34px"],["filter-radius","9px"],["focus-width","2px"],["focus-offset","2px"]]){
  assert.ok(css.includes("--sf-"+key+":"+value+";"));
 }
 for(const name of ["ui/settingsDialog.css","ui/globalSettings.css","components/XuexitongPanels.css"]){
  const source=read(name);
  assert.match(source,/var\(--sf-focus-width\)/);
  assert.match(source,/var\(--sf-focus-offset\)/);
 }
 assert.match(css,/min-height:var\(--sf-control-height\)/);
});
