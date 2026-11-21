const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const source=file=>fs.readFileSync(path.join(__dirname,"..","src",file),"utf8");
const zIndex=(css,selector)=>{
  const block=css.split(selector+"{")[1];
  assert.ok(block,selector+" rule must exist");
  const match=/z-index:\s*(\d+)/.exec(block.split("}")[0]);
  assert.ok(match,selector+" must have an explicit layer");
  return Number(match[1]);
};

test("Zhidao QR login stays above platform and confirmation dialogs",()=>{
  const qr=source("ZhidaoQrDialog.tsx");
  const app=source("App.tsx");
  const css=source("style.css");
  assert.match(app,/onOpenNative=\{\(\)=>setQrOpen\(true\)\}/);
  assert.match(app,/<SettingsDialog open=\{platformSettingsOpen===platform\}/);
  assert.match(qr,/import \{createPortal\} from "react-dom"/);
  assert.match(qr,/createPortal\(<div className="qr-backdrop"/);
  assert.match(qr,/<\/div>,document\.body\)/);
  const layer=zIndex(css,".qr-backdrop");
  assert.ok(layer>zIndex(source("ui/settingsDialog.css"),".app.sf-shell.sf-settings-overlay"));
  assert.ok(layer>zIndex(source("ui/globalSettings.css"),".app.sf-shell.sf-global-settings-overlay"));
  assert.ok(layer>zIndex(source("ui/interactions.css"),".sf-dialog-overlay"));
});

test("QR image remains inside scrollable dialog with readable themed controls",()=>{
  const css=source("style.css");
  assert.match(css,/\.qr-dialog\{[^}]*overflow:auto/);
  assert.match(css,/\.qr-image\{[^}]*object-fit:contain/);
  assert.match(css,/\.qr-backdrop \.qr-footer \.secondary\{color:var\(--qr-fg/);
});
