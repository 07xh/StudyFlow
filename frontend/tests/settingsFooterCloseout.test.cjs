const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const src=p=>fs.readFileSync(path.join(__dirname,"..","src",p),"utf8");

test("settings actions stay in a dedicated footer, independent of scrollable content",()=>{
 const dialog=src("ui/SettingsDialog.tsx"),css=src("ui/settingsDialog.css");
 assert.match(dialog,/footer\?:ReactNode/);
 assert.match(dialog,/\{footer&&<footer className="sf-settings-modal-footer">\{footer\}<\/footer>\}/);
 assert.match(dialog,/sf-settings-modal-body" ref=\{body\}>\{children\}<\/div>/);
 assert.match(css,/\.sf-settings-modal-body\{[^}]*overflow-y:auto/);
 assert.match(css,/\.sf-settings-modal-footer\{[^}]*flex:none/);
 assert.match(css,/@media\(max-width:650px\)\{/);
});

test("ZHS parameters retain original save handlers and show a single save button in the footer",()=>{
 const source=src("components/ZhsTaskSettingsPanel.tsx");
 assert.match(source,/<SettingsDialog open=\{opened\} dark=\{dark\} title="当前课程 · ZHS 参数"/);
 assert.match(source,/footer=\{<div className="actions">/);
 assert.equal((source.match(/<Save size=\{15\}\/>保存参数/g)||[]).length,1);
 assert.equal((source.match(/onClick=\{\(\)=>void load\(\)\}><RefreshCw size=\{15\}\/>重新读取/g)||[]).length,1);
 assert.match(source,/onClick=\{\(\)=>void restoreDefaults\(\)\}/);
 assert.match(source,/disabled=\{!desktop\|\|busy\|\|!valid\|\|!dirty\}/);
});

test("platform settings retain diagnostics navigation without duplicate inline action",()=>{
 const app=src("App.tsx");
 const a=app.indexOf("const renderPlatformSettings=");
 const b=app.indexOf("const renderPlatformDetail=",a);
 assert.ok(a>=0&&b>a);
 assert.doesNotMatch(app.slice(a,b),/打开完整日志与诊断记录/);
 assert.match(app,/footer=\{<div className="actions">[\s\S]*?setPage\("logs"\)/);
 assert.match(app,/disabled=\{settingsDraft\.saving\} onClick=\{closePlatformSettings\}>关闭<\/button>/);
 assert.match(app,/function closePlatformSettings\(\)\{guardSettingsNavigation\(\(\)=>setPlatformSettingsOpen\(null\)\);\}/);
});
