const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const source=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");

test("global settings is one floating workspace, not a route",()=>{
 const app=source("App.tsx"),shell=source("ui/AppShell.tsx");
 assert.doesNotMatch(app,/page==="settings"/);
 assert.doesNotMatch(shell,/onNavigate\("settings"\)/);
 assert.match(shell,/onOpenSettings/);
 assert.match(shell,/aria-haspopup="dialog"/);
 assert.match(app,/<GlobalSettingsModal open=\{globalSettingsOpen\}/);
 assert.match(app,/onOpenUpdates=\{\(\)=>\{releaseChangelog.close\(\);openGlobalSettings\("updates"\);\}\}/);
 assert.match(app,/globalSettingsTab==="general"/);
 assert.match(app,/globalSettingsTab==="updates"/);
 assert.match(app,/globalSettingsTab==="about"/);
 assert.match(app,/<UpdatePanel desktop=\{desktop&&consentAccepted\}/);
 assert.match(app,/<ZhidaoAccountTools desktop=\{desktop\} dark=\{dark\} view="about"\/>/);
});
test("floating global settings portal retains focus, keyboard and resize semantics",()=>{
 const modal=source("ui/GlobalSettingsModal.tsx"),css=source("ui/globalSettings.css");
 assert.match(modal,/createPortal\(/);
 assert.match(modal,/aria-modal="true"/);
 assert.match(modal,/aria-label="设置分类"/);
 assert.match(modal,/aria-label="调整设置导航宽度"/);
 assert.match(modal,/window.localStorage.setItem\(WIDTH_KEY/);
 assert.match(modal,/useModalInteraction\(\{open,panel:panelRef,initialFocus:closeRef,onClose\}\)/);
 assert.match(css,/backdrop-filter:blur/);
 assert.match(css,/overflow:auto/);
 assert.match(css,/@media\(max-width:620px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
test("legal documents close independently and focus returns to their opener",()=>{
 const legal=source("components/ZhidaoAccountTools.tsx");
 assert.match(legal,/event.stopPropagation\(\);setDocument\(null\)/);
 assert.match(legal,/documentCloseRef.current\?\.focus\(\)/);
});
