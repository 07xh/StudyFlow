const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const base=path.join(__dirname,"..","src");
test("license is configured only as a settings component, not a platform gate",()=>{
  const app=fs.readFileSync(path.join(base,"App.tsx"),"utf8");
  const panel=fs.readFileSync(path.join(base,"components","LicensePanel.tsx"),"utf8");
  assert.match(app,/<LicensePanel desktop=\{desktop&&consentAccepted\} visible=\{page==="settings"\}/);
  for(const op of ["license_status","license_activate","license_refresh","license_release"]) {
    assert.ok(panel.includes('"'+op+'"'),"missing "+op);
  }
  assert.ok(!app.includes("license_active &&"),"license must not gate GPL workflows");
});
