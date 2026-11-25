const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const ts=require("typescript");
const read=name=>fs.readFileSync(path.join(__dirname,"../src",name),"utf8");
function loadModal(){
 const document={body:{style:{overflow:"auto"}},activeElement:null};
 class HTMLElement { constructor(disabled=false){this.disabled=disabled;this.isConnected=true;this.focused=0;} matches(selector){return selector===":disabled"&&this.disabled;} focus(){this.focused++;document.activeElement=this;} }
 let frame=null;
 const window={requestAnimationFrame(callback){frame=callback;return 1;},cancelAnimationFrame(){frame=null;}};
 const source=ts.transpileModule(read("ui/modalInteraction.ts"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const context={document,window,HTMLElement,exports:{}};
 vm.runInNewContext(source,context);
 return {document,HTMLElement,flushFrame:()=>{const callback=frame;frame=null;callback?.();},...context.exports};
}
test("nested modal scroll locks restore the original value only after the last release",()=>{
 const {document,acquireModalScrollLock}=loadModal();
 const a=acquireModalScrollLock(),b=acquireModalScrollLock();
 assert.equal(document.body.style.overflow,"hidden");
 assert.equal(a(),false);
 assert.equal(document.body.style.overflow,"hidden");
 assert.equal(b(),true);
 assert.equal(document.body.style.overflow,"auto");
 assert.equal(b(),false);
});
test("nested confirmation can close without unlocking the parent settings",()=>{
 const {document,acquireModalScrollLock}=loadModal();
 const a=acquireModalScrollLock(),b=acquireModalScrollLock();
 assert.equal(b(),true);
 assert.equal(document.body.style.overflow,"hidden");
 assert.equal(a(),true);
 assert.equal(document.body.style.overflow,"auto");
});
test("settings and confirmation dialogs share focus and scroll handling",()=>{
 for(const name of ["SettingsDialog","GlobalSettingsModal","ConfirmDialog"]){
  const source=read("ui/"+name+".tsx");
  assert.match(source,/activateDialog\(\(\)=>/);
  assert.match(source,/trapDialogTab\(event,/);
  assert.match(source,/tabIndex=\{-1\}/);
 }
 assert.doesNotMatch(read("ui/SettingsDialog.tsx"),/onMouseDown=\{handleBackdrop\}/);
 assert.doesNotMatch(read("ui/GlobalSettingsModal.tsx"),/onMouseDown=\{backdrop\}/);
});
test("draft changes require explicit discard and saving blocks settings navigation",()=>{
 const app=read("App.tsx");
 const panel=read("components/XuexitongPanels.tsx");
 assert.match(app,/if\(settingsDraft.saving\)return/);
 assert.match(app,/if\(settingsDraft.dirty\)\{pendingSettingsNavigation.current=action/);
 assert.match(app,/onClose=\{closePlatformSettings\}/);
 assert.match(app,/onDraftChange=\{setSettingsDraft\}/);
 assert.match(app,/onConfirm=\{\(\)=>resolveSettingsDiscard\(true\)\}/);
 assert.match(app,/onCancel=\{\(\)=>resolveSettingsDiscard\(false\)\}/);
 assert.match(panel,/setBaseline\(confirmed\)/);
 assert.match(panel,/onDraftChange\?\.\(\{dirty,saving:busy\}\)/);
});

test("shared dialog focus falls back to the panel and restores the opener",()=>{
 const {document,HTMLElement,activateDialog,flushFrame}=loadModal();
 const opener=new HTMLElement(),disabled=new HTMLElement(true),panel=new HTMLElement();
 opener.focus();
 const close=activateDialog(()=>disabled,()=>panel);
 flushFrame();
 assert.equal(document.activeElement,panel);
 close();
 assert.equal(document.activeElement,opener);
 assert.equal(document.body.style.overflow,"auto");
});
