mod legacy_tasks;

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Manager;

struct QrBridgeWorker {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl QrBridgeWorker {
    fn start(binary: &PathBuf) -> Result<Self, String> {
        let mut command = Command::new(binary);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|_| "Could not start QR service")?;
        let input = child.stdin.take().ok_or("QR service stdin unavailable")?;
        let output = BufReader::new(child.stdout.take().ok_or("QR service stdout unavailable")?);
        Ok(Self { child, input, output })
    }

    fn request(&mut self, message: &[u8]) -> Result<serde_json::Value, String> {
        self.input.write_all(message).map_err(|_| "QR service request failed")?;
        self.input.flush().map_err(|_| "QR service flush failed")?;
        let mut line = String::new();
        self.output.read_line(&mut line).map_err(|_| "QR service response failed")?;
        if line.is_empty() || line.len() > 2_000_000 {
            return Err("QR service returned invalid data".into());
        }
        serde_json::from_str(&line).map_err(|_| "QR service protocol error".into())
    }
}

impl Drop for QrBridgeWorker {
    fn drop(&mut self) {
        // Ask Python to stop the QR child and clear only its ephemeral PNG.
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.request(b"{\"id\":\"shutdown\",\"version\":1,\"operation\":\"zhidao.qr.cancel\"}\n");
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

type QrBridgeState = Arc<Mutex<Option<QrBridgeWorker>>>;

pub(crate) fn bridge_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app.path().resource_dir().map_err(|_| "Resource directory unavailable")?
        .join("bin").join("studyflow-bridge.exe");
    if packaged.is_file() {
        return Ok(packaged);
    }
    if cfg!(debug_assertions) {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..").join("packaging").join("sidecar").join("studyflow-bridge.exe");
        if development.is_file() {
            return Ok(development);
        }
    }
    Err("Python learning service is missing; reinstall StudyFlow".into())
}

fn validate(request: &serde_json::Value) -> Result<(), String> {
    let id = request.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() || id.len() > 128 || request.get("version").and_then(|v| v.as_i64()) != Some(1) {
        return Err("Invalid request envelope".into());
    }
    let operation = request.get("operation").and_then(|v| v.as_str()).unwrap_or("");
    match operation {
        "ping" | "platform.status" | "yuketang.clear"
        | "zhidao.qr.start" | "zhidao.qr.status" | "zhidao.qr.cancel"
        | "zhidao.progress.sync" => Ok(()),
        "zhidao.progress.verify" if request.get("course_key").and_then(|x| x.as_str())
            .is_some_and(|key| key.len() == 64
                && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))) => Ok(()),
        "courses.list" if matches!(request.get("platform").and_then(|p| p.as_str()), Some("zhidao" | "yuketang")) => Ok(()),
        "videos.list" if request.get("platform").and_then(|p| p.as_str()) == Some("yuketang") => Ok(()),
        "yuketang.progress" if request.get("run_id").and_then(|x| x.as_str())
            .is_some_and(|id| {
                let mut parts = id.split('-');
                matches!((parts.next(),parts.next(),parts.next()), (Some(a), Some(b), None)
                    if !a.is_empty() && a.len()<=15 && a.bytes().all(|ch| ch.is_ascii_digit())
                    && !b.is_empty() && b.len()<=20 && b.bytes().all(|ch| ch.is_ascii_digit()))
            }) => Ok(()),
        "yuketang.configure" if request.get("configuration").map_or(false, |x| x.is_object()) => Ok(()),
        "yuketang.settings.get" => Ok(()),
        "yuketang.settings.save" if request.get("settings").map_or(false, |x| x.is_object()) => Ok(()),
        "zhidao.cookie.import"
            if request.get("content").and_then(|v| v.as_str()).map_or(false, |v| v.as_bytes().len() <= 262_144)
                && matches!(request.get("mode").and_then(|v| v.as_str()), Some("file" | "text")) => Ok(()),
        _ => Err("Operation not permitted".into()),
    }
}

#[tauri::command]
async fn bridge_request(app: tauri::AppHandle, request: serde_json::Value)
    -> Result<serde_json::Value, String> {
    validate(&request)?;
    let binary = bridge_binary(&app)?;
    let mut message = serde_json::to_vec(&request).map_err(|_| "Request encoding failed")?;
    if message.len() > 600_000 {
        return Err("Request is too large".into());
    }
    message.push(b'\n');
    let is_qr = request.get("operation").and_then(|x| x.as_str())
        .map_or(false, |op| op.starts_with("zhidao.qr."));
    if is_qr {
        // QR start/status/cancel must share the same Python process; ordinary
        // requests intentionally retain the existing one-shot behavior.
        let shared = app.state::<QrBridgeState>().inner().clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let mut slot = shared.lock().map_err(|_| "QR service lock failed")?;
            if slot.is_none() {
                *slot = Some(QrBridgeWorker::start(&binary)?);
            }
            let reply = slot.as_mut().ok_or("QR service unavailable")?.request(&message);
            if reply.is_err() { *slot = None; }
            reply
        }).await.map_err(|_| "QR service worker crashed".to_string())?;
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let mut command = Command::new(binary);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|_| "Could not start Python service")?;
        if let Some(mut input) = child.stdin.take() {
            input.write_all(&message).map_err(|_| "Could not send request")?;
        }
        let output = child.wait_with_output().map_err(|_| "Python service failed")?;
        if !output.status.success() || output.stdout.len() > 1_048_576 {
            return Err("Python service returned an invalid response".into());
        }
        let value: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "Python service protocol error")?;
        if value.get("ok").and_then(|x| x.as_bool()).is_none() {
            return Err("Python service protocol error".into());
        }
        Ok(value)
    }).await.map_err(|_| "Python service worker crashed".to_string())?
}

#[tauri::command]
fn launch_zhidao_legacy() -> Result<(), String> {
    let dir = std::env::var_os("LOCALAPPDATA").ok_or("Windows app directory unavailable")?;
    let script = PathBuf::from(dir).join("ZHSDesktop").join("Zhidao-GUI.ps1");
    if !script.is_file() {
        return Err("原版知到客户端未安装，请先安装并登录".into());
    }
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-File"]).arg(script);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn().map_err(|_| "无法打开原版知到登录窗口")?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(None::<QrBridgeWorker>)))
        .manage(legacy_tasks::LegacyTasks::default())
        .invoke_handler(tauri::generate_handler![
            bridge_request, launch_zhidao_legacy,
            legacy_tasks::legacy_start, legacy_tasks::legacy_status, legacy_tasks::legacy_stop
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<legacy_tasks::LegacyTasks>().shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to launch StudyFlow");
}



#[cfg(test)]
mod ipc_validation_tests {
    use super::validate;
    use serde_json::json;

    #[test]
    fn allows_zhidao_readonly_progress_operations() {
        assert!(validate(&json!({"id":"a","version":1,"operation":"zhidao.progress.sync"})).is_ok());
        assert!(validate(&json!({"id":"b","version":1,"operation":"zhidao.progress.verify","course_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})).is_ok());
    }

    #[test]
    fn rejects_malformed_zhidao_course_keys_at_tauri_boundary() {
        for key in ["../invalid", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] {
            assert!(validate(&json!({"id":"c","version":1,"operation":"zhidao.progress.verify","course_key":key})).is_err());
        }
    }
}
