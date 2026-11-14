use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::Manager;

fn bridge_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
        "ping" | "platform.status" | "yuketang.clear" => Ok(()),
        "courses.list" if matches!(request.get("platform").and_then(|p| p.as_str()), Some("zhidao" | "yuketang")) => Ok(()),
        "videos.list" if request.get("platform").and_then(|p| p.as_str()) == Some("yuketang") => Ok(()),
        "yuketang.configure" if request.get("configuration").map_or(false, |x| x.is_object()) => Ok(()),
        _ => Err("Operation not permitted".into()),
    }
}

#[tauri::command]
async fn bridge_request(app: tauri::AppHandle, request: serde_json::Value)
    -> Result<serde_json::Value, String> {
    validate(&request)?;
    let binary = bridge_binary(&app)?;
    let mut message = serde_json::to_vec(&request).map_err(|_| "Request encoding failed")?;
    if message.len() > 60_000 {
        return Err("Request is too large".into());
    }
    message.push(b'\n');
    tauri::async_runtime::spawn_blocking(move || {
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
        .invoke_handler(tauri::generate_handler![bridge_request, launch_zhidao_legacy])
        .run(tauri::generate_context!())
        .expect("Failed to launch StudyFlow");
}
