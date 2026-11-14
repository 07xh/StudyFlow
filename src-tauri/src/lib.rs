mod legacy_tasks;
mod zhidao_player;

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
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

fn consent_flag_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(|home| {
            PathBuf::from(home).join("AppData").join("Local")
        }))
        .ok_or_else(|| "CONSENT_STORAGE_FAILED".to_string())?;
    Ok(base.join("StudyFlow").join("privacy-accepted-v1.flag"))
}

fn read_legal_resource(app: &tauri::AppHandle, name: &str, max_bytes: u64) -> Result<String, String> {
    let packaged = app.path().resource_dir().ok().map(|dir| dir.join("legal").join(name));
    let development = if cfg!(debug_assertions) {
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..").join("legacy").join("zhidao").join(name))
    } else {
        None
    };
    let path = packaged.filter(|path| path.is_file())
        .or_else(|| development.filter(|path| path.is_file()))
        .ok_or_else(|| "DOCUMENT_UNAVAILABLE".to_string())?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| "DOCUMENT_UNAVAILABLE".to_string())?;
    if metadata.file_type().is_symlink() || metadata.len() > max_bytes {
        return Err("DOCUMENT_UNAVAILABLE".into());
    }
    fs::read_to_string(path).map_err(|_| "DOCUMENT_UNAVAILABLE".into())
}

// Legal disclosure is read directly from Tauri's bundled resources. It must
// remain available even when the optional Python sidecar cannot be started.
#[tauri::command]
fn studyflow_consent_status() -> Result<serde_json::Value, String> {
    let path = consent_flag_path()?;
    let accepted = match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || metadata.len() > 256 => false,
        Ok(_) => fs::read_to_string(&path)
            .map(|value| value.starts_with("StudyFlow privacy notice v1 accepted at "))
            .unwrap_or(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => false,
    };
    Ok(serde_json::json!({"accepted": accepted}))
}

#[tauri::command]
fn studyflow_consent_accept() -> Result<serde_json::Value, String> {
    let path = consent_flag_path()?;
    let parent = path.parent().ok_or_else(|| "CONSENT_STORAGE_FAILED".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "CONSENT_STORAGE_FAILED".to_string())?;
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() {
            return Err("CONSENT_STORAGE_FAILED".into());
        }
    }

    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_nanos();
    let temporary = parent.join(format!(".consent-{}-{stamp}.tmp", std::process::id()));
    let value = format!(
        "StudyFlow privacy notice v1 accepted at {}",
        chrono_free_timestamp()
    );
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)
            .map_err(|_| "CONSENT_STORAGE_FAILED".to_string())?;
        file.write_all(value.as_bytes()).map_err(|_| "CONSENT_STORAGE_FAILED".to_string())?;
        file.sync_all().map_err(|_| "CONSENT_STORAGE_FAILED".to_string())?;
        drop(file);

        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err("CONSENT_STORAGE_FAILED".into());
                }
                fs::remove_file(&path).map_err(|_| "CONSENT_STORAGE_FAILED".to_string())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("CONSENT_STORAGE_FAILED".into()),
        }
        fs::rename(&temporary, &path).map_err(|_| "CONSENT_STORAGE_FAILED".to_string())?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result?;
    Ok(serde_json::json!({"accepted": true}))
}

fn chrono_free_timestamp() -> String {
    // A stable UTC timestamp without adding another runtime dependency.
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    format!("unix-{seconds}")
}

#[tauri::command]
fn studyflow_read_document(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<serde_json::Value, String> {
    let (filename, title) = match document_id.as_str() {
        "terms" => ("使用条款与第三方声明.txt", "使用条款与第三方声明.txt"),
        "privacy" => ("隐私政策与数据说明.txt", "隐私政策与数据说明.txt"),
        "license" => ("LICENSE-GPL-3.0.txt", "GPL-3.0 开源许可"),
        "source" => ("SOURCE.md", "第三方源码说明"),
        _ => return Err("INVALID_DOCUMENT".into()),
    };
    let mut content = read_legal_resource(&app, filename, 512 * 1024)?;
    if document_id == "privacy" {
        content.push_str("\n\n");
        content.push_str(&read_legal_resource(
            &app, "StudyFlow-隐私补充说明.txt", 128 * 1024
        )?);
    }
    Ok(serde_json::json!({
        "id": document_id,
        "title": title,
        "content": content
    }))
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
        | "zhidao.progress.sync" | "zhidao.player.settings.get"
        | "zhidao.diagnose" | "zhidao.session.clear" | "zhidao.cache.clear"
        | "studyflow.consent.status" | "studyflow.consent.accept" => Ok(()),
        "zhidao.progress.verify" | "zhidao.player.target"
            if request.get("course_key").and_then(|x| x.as_str())
                .is_some_and(|key| key.len() == 64
                    && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))) => Ok(()),
        "zhidao.player.settings.save" if request.get("settings").map_or(false, |x| x.is_object()) => Ok(()),
        "zhidao.course.detail" if request.get("course_key").and_then(|x| x.as_str())
            .is_some_and(|key| key.len() == 64
                && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))) => Ok(()),
        "zhidao.document.read" if request.get("document_id").and_then(|x| x.as_str())
            .is_some_and(|id| matches!(id, "terms" | "privacy" | "license" | "source")) => Ok(()),
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

fn parse_jsonl_reply(stdout: &[u8], expected_id: &str) -> Result<serde_json::Value, String> {
    if stdout.is_empty() || stdout.len() > 1_048_576 {
        return Err("Python service returned an invalid response".into());
    }
    let mut lines = stdout.split(|byte| *byte == b'\\n')
        .filter(|line| !line.iter().all(|byte| byte.is_ascii_whitespace()));
    let line = lines.next().ok_or_else(|| "Python service protocol error".to_string())?;
    if lines.next().is_some() {
        return Err("Python service protocol error".into());
    }
    let value: serde_json::Value = serde_json::from_slice(line)
        .map_err(|_| "Python service protocol error".to_string())?;
    if value.get("id").and_then(|item| item.as_str()) != Some(expected_id)
        || value.get("ok").and_then(|item| item.as_bool()).is_none()
    {
        return Err("Python service protocol error".into());
    }
    Ok(value)
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
    let expected_id = request.get("id").and_then(|value| value.as_str())
        .ok_or("Invalid request id")?.to_string();
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
        if !output.status.success() {
            return Err("Python service returned an invalid response".into());
        }
        parse_jsonl_reply(&output.stdout, &expected_id)
    }).await.map_err(|_| "Python service worker crashed".to_string())?
}

#[tauri::command]
fn zhidao_open_official_site() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new("cmd.exe")
            .args(["/C", "start", "", "https://www.zhihuishu.com/"])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "OFFICIAL_SITE_OPEN_FAILED")?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("WINDOWS_ONLY".into())
    }
}

#[tauri::command]
fn studyflow_exit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn zhidao_open_data_folder() -> Result<(), String> {
    let home = std::env::var_os("USERPROFILE").ok_or("USERPROFILE_UNAVAILABLE")?;
    let folder = PathBuf::from(home).join(".zhs");
    std::fs::create_dir_all(&folder).map_err(|_| "ZHS_DATA_FOLDER_UNAVAILABLE")?;
    #[cfg(windows)]
    {
        Command::new("explorer.exe").arg(folder).spawn()
            .map_err(|_| "ZHS_DATA_FOLDER_OPEN_FAILED")?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("WINDOWS_ONLY".into())
    }
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
        .manage(zhidao_player::ZhidaoPlayerManager::default())
        .invoke_handler(tauri::generate_handler![
            bridge_request, launch_zhidao_legacy, zhidao_open_data_folder, zhidao_open_official_site, studyflow_exit,
            studyflow_consent_status, studyflow_consent_accept, studyflow_read_document,
            zhidao_player::zhidao_player_prepare, zhidao_player::zhidao_player_start,
            zhidao_player::zhidao_player_status, zhidao_player::zhidao_player_stop,
            zhidao_player::zhidao_player_clear_web_profile,
            legacy_tasks::legacy_start, legacy_tasks::legacy_status, legacy_tasks::legacy_stop
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<legacy_tasks::LegacyTasks>().shutdown();
                window.state::<zhidao_player::ZhidaoPlayerManager>().shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to launch StudyFlow");
}



#[cfg(test)]
mod ipc_validation_tests {
    use super::{parse_jsonl_reply, validate};
    use serde_json::json;

    #[test]
    fn accepts_one_correlated_jsonl_reply() {
        let reply = parse_jsonl_reply(
            b"{\\"id\\":\\"req-1\\",\\"ok\\":true,\\"data\\":{}}\\n",
            "req-1",
        ).unwrap();
        assert_eq!(reply["id"], "req-1");
        assert_eq!(reply["ok"], true);
    }

    #[test]
    fn rejects_stdout_noise_and_mismatched_jsonl_ids() {
        assert!(parse_jsonl_reply(
            b"debug output\\n{\\"id\\":\\"req-1\\",\\"ok\\":true}\\n",
            "req-1",
        ).is_err());
        assert!(parse_jsonl_reply(
            b"{\\"id\\":\\"other\\",\\"ok\\":true}\\n",
            "req-1",
        ).is_err());
    }

    #[test]
    fn allows_zhidao_readonly_progress_operations() {
        assert!(validate(&json!({"id":"a","version":1,"operation":"zhidao.progress.sync"})).is_ok());
        assert!(validate(&json!({"id":"b","version":1,"operation":"zhidao.progress.verify","course_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})).is_ok());
        assert!(validate(&json!({"id":"c","version":1,"operation":"zhidao.player.target","course_key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"})).is_ok());
        assert!(validate(&json!({"id":"d","version":1,"operation":"zhidao.player.settings.get"})).is_ok());
        assert!(validate(&json!({"id":"e","version":1,"operation":"zhidao.diagnose"})).is_ok());
        assert!(validate(&json!({"id":"f","version":1,"operation":"zhidao.session.clear"})).is_ok());
        assert!(validate(&json!({"id":"g","version":1,"operation":"zhidao.cache.clear"})).is_ok());
        assert!(validate(&json!({"id":"h","version":1,"operation":"zhidao.document.read","document_id":"privacy"})).is_ok());
        assert!(validate(&json!({"id":"i","version":1,"operation":"zhidao.player.settings.save","settings":{}})).is_ok());
        assert!(validate(&json!({"id":"j","version":1,"operation":"zhidao.course.detail","course_key":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"})).is_ok());
        assert!(validate(&json!({"id":"k","version":1,"operation":"studyflow.consent.status"})).is_ok());
        assert!(validate(&json!({"id":"l","version":1,"operation":"studyflow.consent.accept"})).is_ok());
        assert!(validate(&json!({"id":"m","version":1,"operation":"zhidao.diagnose"})).is_ok());
    }

    #[test]
    fn rejects_malformed_zhidao_course_keys_at_tauri_boundary() {
        for key in ["../invalid", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] {
            assert!(validate(&json!({"id":"c","version":1,"operation":"zhidao.progress.verify","course_key":key})).is_err());
        }
    }
}
