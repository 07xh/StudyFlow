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
  assert.match(source,/"tray-quit" => \{\s*request_shutdown\(app\);/);
  assert.match(source,/let _ = window\.unminimize\(\);\s*let _ = window\.show\(\);\s*let _ = window\.set_focus\(\);/);
  assert.match(source,/show_main_from_tray\(tray\.app_handle\(\)\)/);
  assert.doesNotMatch(source,/OCSWorker|ocsjs|localhost:8194/);
});

test("close hides the existing main window but explicit exit still cleans up Sidecar",()=>{
  const source=read("src-tauri/src/lib.rs");
  const shell=read("frontend/src/ui/AppShell.tsx");
  assert.match(source,/tauri::WindowEvent::CloseRequested \{ api, \.\. \} => \{/);
  // Normal desktop launch still hides the existing window to tray.
  // Explicit --exit-on-close (used only by the installer smoke) exercises
  // graceful app exit instead of merely hiding it.
  assert.match(source,/api\.prevent_close\(\);/);
  assert.match(source,/std::env::args_os\(\)\.any\(\|arg\| arg == "--exit-on-close"\)/);
  assert.match(source,/if std::env::args_os\(\)\.any\([^)]+\) \{\s*request_shutdown\(window\.app_handle\(\)\);\s*\} else \{\s*let _ = window\.hide\(\);/s);
  assert.match(source,/tauri::WindowEvent::Destroyed => \{[^}]*request_shutdown\(window\.app_handle\(\)\);/s);
  assert.match(source,/fn studyflow_exit\(app: tauri::AppHandle\) \{\s*request_shutdown\(&app\);/);
  assert.match(shell,/aria-label="关闭窗口（收起到系统托盘）"/);
  assert.match(shell,/getCurrentWindow\(\)\.close\(\)/);
  assert.doesNotMatch(shell,/\bnew Window\(|window\.open\(/);
});


test("explicit exit cleanup is single-flight and off the native event loop",()=>{
  const source=read("src-tauri/src/lib.rs");
  assert.match(source,/\.manage\(ShutdownState::default\(\)\)/);
  assert.match(source,/\.swap\(true, Ordering::AcqRel\) \{\s*return;/);
  assert.match(source,/std::thread::spawn\(move \|\| \{\s*shutdown_owned_services\(&app\);\s*app\.exit\(0\);/);
});
