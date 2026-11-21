const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"../..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("StudyFlow owns one native tray with an explicit restore and quit",()=>{
  const cargo=read("src-tauri/Cargo.toml");
  const source=read("src-tauri/src/lib.rs");
  assert.match(cargo,/tauri = \{ version = "2", features = \["tray-icon"\] \}/);
  assert.match(source,/TrayIconBuilder::new\(\)/);
  assert.match(source,/MenuItem::with_id\(app, "tray-show", "显示学序"/);
  assert.match(source,/MenuItem::with_id\(app, "tray-quit", "完全退出学序"/);
  assert.match(source,/\.show_menu_on_left_click\(false\)/);
  assert.match(source,/"tray-show" => show_main_from_tray\(app\)/);
  assert.match(source,/"tray-quit" => \{\s*shutdown_owned_services\(app\);\s*app\.exit\(0\);/);
  assert.match(source,/let _ = window\.unminimize\(\);\s*let _ = window\.show\(\);\s*let _ = window\.set_focus\(\);/);
  assert.match(source,/show_main_from_tray\(tray\.app_handle\(\)\)/);
  assert.doesNotMatch(source,/OCSWorker|ocsjs|localhost:8194/);
});

test("close hides the existing main window but explicit exit still cleans up Sidecar",()=>{
  const source=read("src-tauri/src/lib.rs");
  const shell=read("frontend/src/ui/AppShell.tsx");
  assert.match(source,/tauri::WindowEvent::CloseRequested \{ api, \.\. \} => \{/);
  assert.match(source,/api\.prevent_close\(\);\s*let _ = window\.hide\(\);/);
  assert.match(source,/tauri::WindowEvent::Destroyed => \{[^}]*shutdown_owned_services\(window\.app_handle\(\)\);/s);
  assert.match(source,/fn studyflow_exit\(app: tauri::AppHandle\) \{\s*shutdown_owned_services\(&app\);\s*app\.exit\(0\);/);
  assert.match(shell,/aria-label="收起到系统托盘"/);
  assert.match(shell,/getCurrentWindow\(\)\.close\(\)/);
  assert.doesNotMatch(shell,/\bnew Window\(|window\.open\(/);
});
