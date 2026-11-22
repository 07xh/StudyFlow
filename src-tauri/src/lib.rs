mod run_identity;
mod legacy_tasks;
mod zhs_queue;
mod zhidao_player;

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

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

    fn request(&mut self, message: &[u8], expected_id: &str) -> Result<serde_json::Value, String> {
        self.input.write_all(message).map_err(|_| "QR service request failed")?;
        self.input.flush().map_err(|_| "QR service flush failed")?;
        let mut line = String::new();
        self.output.read_line(&mut line).map_err(|_| "QR service response failed")?;
        if line.is_empty() || line.len() > 1_048_576 {
            return Err("QR service returned invalid data".into());
        }
        parse_jsonl_reply(line.as_bytes(), expected_id)
    }
}

impl Drop for QrBridgeWorker {
    fn drop(&mut self) {
        // Ask Python to stop the QR child and clear only its ephemeral PNG.
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.request(
                b"{\"id\":\"shutdown\",\"version\":1,\"operation\":\"zhidao.qr.cancel\"}\n",
                "shutdown",
            );
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
        "questionbank.providers" | "questionbank.tokens.list" => Ok(()),
        "questionbank.tokens.add"
            if request.get("provider_id").and_then(|v| v.as_str())
                .is_some_and(|v| !v.is_empty() && v.len() <= 40
                    && v.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'))
            && request.get("label").and_then(|v| v.as_str())
                .is_some_and(|v| !v.trim().is_empty() && v.chars().count() <= 50)
            && request.get("token").and_then(|v| v.as_str())
                .is_some_and(|v| (8..=512).contains(&v.len())
                    && v.bytes().all(|c| c.is_ascii_graphic()))
            => Ok(()),
        "questionbank.tokens.select" | "questionbank.tokens.remove"
            if request.get("token_id").and_then(|v| v.as_str())
                .is_some_and(|v| v.len() == 32 && v.bytes().all(|c| c.is_ascii_hexdigit()))
            => Ok(()),
        "questionbank.query"
            if request.get("provider_id").and_then(|v| v.as_str())
                .is_some_and(|v| !v.is_empty() && v.len() <= 40
                    && v.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'))
            && request.get("token_id").map_or(true, |v| v.as_str()
                .is_some_and(|s| s.len() == 32 && s.bytes().all(|c| c.is_ascii_hexdigit())))
            && request.get("question").and_then(|q| q.as_object()).is_some_and(|q| {
                q.get("title").and_then(|v| v.as_str())
                    .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 4000)
                && q.get("question_type").map_or(true, |v| v.as_str()
                    .is_some_and(|s| s.chars().count() <= 40))
                && q.get("options").map_or(true, |v| {
                    v.as_str().is_some_and(|s| s.chars().count() <= 4000)
                    || v.as_array().is_some_and(|items| items.len() <= 20
                        && items.iter().all(|item| item.as_object().is_some_and(|entry| {
                            entry.get("key").map_or(true, |value| value.as_str()
                                .is_some_and(|s| s.chars().count() <= 10))
                            && entry.get("text").and_then(|value| value.as_str())
                                .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 500)
                        })))
                })
            })
            => Ok(()),
        "questionbank.yanxi.status" | "questionbank.yanxi.clear" => Ok(()),
        "questionbank.yanxi.save"
            if request.get("token").and_then(|v| v.as_str())
                .is_some_and(|s| (8..=256).contains(&s.len())
                    && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
            => Ok(()),
        "questionbank.yanxi.query"
            if request.get("title").and_then(|v| v.as_str())
                .is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 4000)
            && request.get("options").map_or(true, |v| v.as_str()
                .is_some_and(|s| s.chars().count() <= 4000))
            && request.get("question_type").map_or(true, |v| v.as_str()
                .is_some_and(|s| s.chars().count() <= 40))
            => Ok(()),
        "ping" | "platform.status" | "yuketang.clear" | "updates.settings.get" | "updates.latest"
        | "zhidao.qr.start" | "zhidao.qr.status" | "zhidao.qr.cancel"
        | "zhidao.progress.sync" | "zhidao.player.settings.get"
        | "zhidao.diagnose" | "zhidao.session.clear" | "zhidao.cache.clear"
        | "studyflow.consent.status" | "studyflow.consent.accept" | "yuketang.scope.get"
        | "yuketang.session.marker" | "xuexitong.session.clear" | "xuexitong.settings.get"
        | "ucampus.session.info" | "ucampus.session.clear"
        | "ucampus.heartbeat.capabilities" | "ucampus.socket.diagnose"
        | "ucampus.fabricated.capabilities" => Ok(()),
        "updates.settings.save" if request.get("settings").is_some_and(|value|
            matches!(value.get("channel").and_then(|v| v.as_str()), Some("stable" | "beta"))
            && matches!(value.get("mode").and_then(|v| v.as_str()), Some("notify" | "download"))) => Ok(()),
        "updates.changelog" if request.get("current_version")
            .and_then(|v| v.as_str()).is_some_and(|v| !v.is_empty() && v.len() <= 80)
            && request.get("previous_version").map_or(true, |v| v.as_str()
                .is_some_and(|s| !s.is_empty() && s.len() <= 80))
            && request.get("history").is_some_and(|v| v.is_boolean()) => Ok(()),
        "updates.check" | "updates.download" if request.get("current_version")
            .and_then(|v| v.as_str()).is_some_and(|v| !v.is_empty() && v.len() <= 80)
            && (operation != "updates.download" || request.get("release_version")
                .and_then(|v| v.as_str()).is_some_and(|v| !v.is_empty() && v.len() <= 80)) => Ok(()),
        "zhidao.progress.verify" | "zhidao.player.target"
            if request.get("course_key").and_then(|x| x.as_str())
                .is_some_and(|key| key.len() == 64
                    && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))) => Ok(()),
        // ZHS task options are per-course or global. Validate the optional
        // course key at the native IPC boundary just like the Python adapter.
        "zhidao.zhs.settings.get" if request.get("course_key").map_or(true, |key| key.as_str()
            .is_some_and(|key| key.len() == 64
                && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)))) => Ok(()),
        "zhidao.zhs.settings.save" if request.get("settings").is_some_and(|value| value.is_object())
            && request.get("course_key").map_or(true, |key| key.as_str()
                .is_some_and(|key| key.len() == 64
                    && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)))) => Ok(()),
        "zhidao.player.settings.save" if request.get("settings").map_or(false, |x| x.is_object()) => Ok(()),
        "zhidao.course.detail" if request.get("course_key").and_then(|x| x.as_str())
            .is_some_and(|key| key.len() == 64
                && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))) => Ok(()),
        "zhidao.document.read" if request.get("document_id").and_then(|x| x.as_str())
            .is_some_and(|id| matches!(id, "terms" | "privacy" | "license" | "source")) => Ok(()),
        // The mastery worker shares the existing ZHS sidecar session with the
        // manual exercise panel. Check the same course identity at native IPC.
        "zhidao.mastery.auto.start" if request.get("course_key").and_then(|x| x.as_str())
            .is_some_and(|key| key.len() == 64
                && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)))
            && request.get("settings").and_then(|x| x.as_object()).is_some_and(|opts| {
                let mode = opts.get("first_round_mode").and_then(|v| v.as_str()).unwrap_or("bank_only");
                matches!(mode, "bank_only" | "bank_ai" | "ai_first" | "arbitrary_first")
                    && opts.get("target").and_then(|v| v.as_u64()).is_some_and(|n| (1..=100).contains(&n))
                    && opts.get("max_rounds").and_then(|v| v.as_u64()).is_some_and(|n| (1..=30).contains(&n))
                    && opts.get("max_minutes").and_then(|v| v.as_u64()).is_some_and(|n| (1..=720).contains(&n))
                    && opts.get("stagnation_rounds").and_then(|v| v.as_u64()).is_some_and(|n| (1..=10).contains(&n))
                    && opts.get("max_ai_calls").and_then(|v| v.as_u64()).is_some_and(|n| (1..=100).contains(&n))
                    && opts.get("use_external_bank").map_or(true, |v| v.is_boolean())
                    && opts.get("max_external_calls").map_or(true, |v| v.as_u64()
                        .is_some_and(|n| (1..=200).contains(&n)))
                    && (opts.get("use_external_bank").and_then(|v| v.as_bool()) != Some(true)
                        || (opts.get("external_provider_id").and_then(|v| v.as_str())
                            .is_some_and(|s| !s.is_empty() && s.len() <= 40
                                && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'))
                            && opts.get("external_token_id").and_then(|v| v.as_str())
                                .is_some_and(|s| s.len() == 32
                                    && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))))
                    && opts.get("api_key").map_or(matches!(mode, "bank_only" | "arbitrary_first"), |k| k.as_str()
                        .is_some_and(|s| s.len() <= 256 && !s.contains('\r') && !s.contains('\n')
                            && (matches!(mode, "bank_only" | "arbitrary_first") || !s.trim().is_empty())))
            }) => Ok(()),
        "zhidao.mastery.auto.status" if request.get("course_key").and_then(|x| x.as_str())
            .is_some_and(|key| key.len() == 64
                && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))) => Ok(()),
        "zhidao.mastery.auto.control" if request.get("course_key").and_then(|x| x.as_str())
            .is_some_and(|key| key.len() == 64
                && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)))
            && matches!(request.get("action").and_then(|v| v.as_str()), Some("pause" | "resume" | "stop")) => Ok(()),
        "zhidao.mastery.catalog" | "zhidao.mastery.round.active"
        | "zhidao.mastery.round.start" | "zhidao.mastery.round.submit"
        | "zhidao.mastery.round.discard" | "zhidao.mastery.wrong"
            if request.get("course_key").and_then(|x| x.as_str())
                .is_some_and(|key| key.len() == 64
                    && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)))
            && (operation == "zhidao.mastery.catalog"
                || request.get("knowledge_id").and_then(|v| v.as_str())
                    .is_some_and(|id| !id.is_empty() && id.len() <= 24
                        && id.bytes().all(|c| c.is_ascii_digit()))) => Ok(()),
        "zhidao.mastery.round.answer" if request.get("course_key").and_then(|x| x.as_str())
            .is_some_and(|key| key.len() == 64
                && key.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)))
            && request.get("knowledge_id").and_then(|v| v.as_str())
                .is_some_and(|id| !id.is_empty() && id.len() <= 24
                    && id.bytes().all(|c| c.is_ascii_digit()))
            && request.get("question_id").and_then(|v| v.as_str())
                .is_some_and(|id| !id.is_empty() && id.len() <= 24
                    && id.bytes().all(|c| c.is_ascii_digit()))
            && request.get("answer").is_some_and(|v| v.is_string() || v.is_number() || v.is_array()) => Ok(()),
        "courses.list" if matches!(request.get("platform").and_then(|p| p.as_str()), Some("zhidao" | "yuketang" | "xuexitong" | "ucampus")) => Ok(()),
        "ucampus.monitor.status" | "ucampus.monitor.tick" => Ok(()),
        "ucampus.monitor.configure" if request.get("enabled").and_then(|v| v.as_bool())
            .is_some_and(|enabled| !enabled || (
                request.get("course_id").and_then(|x| x.as_str())
                    .is_some_and(|x| !x.is_empty() && x.len() <= 128
                        && x.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
                && request.get("unit_id").and_then(|x| x.as_str())
                    .is_some_and(|x| !x.is_empty() && x.len() <= 128
                        && x.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
            )) => Ok(()),
        "ucampus.session.login" if request.get("username").and_then(|v| v.as_str())
            .is_some_and(|s| !s.trim().is_empty() && s.len() <= 128
                && !s.contains('\r') && !s.contains('\n') && !s.contains('\0'))
            && request.get("password").and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty() && s.len() <= 256
                    && !s.contains('\r') && !s.contains('\n') && !s.contains('\0'))
                => Ok(()),
        "ucampus.session.configure" if request.get("configuration").and_then(|v| v.as_object())
            .is_some_and(|data| data.len() >= 2 && data.len() <= 6
                && matches!(data.get("variant").and_then(|v| v.as_str()), Some("ai" | "classic"))
                && data.get("cookie").and_then(|v| v.as_str()).is_some_and(|s|
                    !s.is_empty() && s.len() <= 8192 && !s.contains('\r') && !s.contains('\n'))
                && data.get("catalog_url").map_or(true, |v| v.as_str().is_some_and(|s|
                    s.len() <= 2048 && !s.contains('\r') && !s.contains('\n')))
                && data.get("authorization").map_or(true, |v| v.as_str().is_some_and(|s|
                    s.len() <= 8192 && !s.contains('\r') && !s.contains('\n')))
                && data.get("annotator_token").map_or(true, |v| v.as_str().is_some_and(|s|
                    s.len() <= 4096 && !s.contains('\r') && !s.contains('\n')))
                && data.get("school_id").map_or(true, |v| v.as_str().is_some_and(|s|
                    s.len() <= 24 && s.bytes().all(|c| c.is_ascii_digit())))) => Ok(()),
        "ucampus.units.list" | "ucampus.unit.tasks" | "ucampus.progress.verify" if request.get("course_id")
            .and_then(|v| v.as_str()).is_some_and(|v| !v.is_empty() && v.len() <= 128
                && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
            && (operation == "ucampus.units.list" || request.get("unit_id")
                .and_then(|v| v.as_str()).is_some_and(|v| !v.is_empty() && v.len() <= 128
                && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+')))
                => Ok(()),
        "ucampus.heartbeat.status" if request.get("course_id").and_then(|v| v.as_str())
            .is_some_and(|v| !v.is_empty() && v.len() <= 128
                && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+')) => Ok(()),
        "ucampus.heartbeat.start" if request.get("course_id").and_then(|v| v.as_str())
            .is_some_and(|v| !v.is_empty() && v.len() <= 128
                && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
            && request.get("unit_id").and_then(|v| v.as_str())
            .is_some_and(|v| !v.is_empty() && v.len() <= 128
                && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
            && request.get("pulses").map_or(true, |v| v.as_u64().is_some_and(|n| (1..=100).contains(&n)))
            => Ok(()),
        "ucampus.heartbeat.pause" | "ucampus.heartbeat.resume" | "ucampus.heartbeat.stop"
            if request.get("graceful").is_none()
                && request.get("course_id").and_then(|v| v.as_str())
                    .is_some_and(|v| !v.is_empty() && v.len() <= 128
                        && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
                && request.get("run_id").and_then(|v| v.as_str())
                    .is_some_and(|id| id.len() == 32
                        && id.bytes().all(|b| b.is_ascii_hexdigit())) => Ok(()),
        "ucampus.fabricated.status" | "ucampus.fabricated.history" if request.get("course_id").and_then(|v| v.as_str())
            .is_some_and(|v| !v.is_empty() && v.len() <= 128
                && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+')) => Ok(()),
        "ucampus.fabricated.start" if request.get("course_id").and_then(|v| v.as_str())
            .is_some_and(|v| !v.is_empty() && v.len() <= 128
                && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
            && request.get("unit_id").and_then(|v| v.as_str())
                .is_some_and(|v| !v.is_empty() && v.len() <= 128
                    && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
            && request.get("pulses").map_or(true, |v| v.as_u64().is_some_and(|n| (1..=100).contains(&n)))
            && request.get("speed").map_or(true, |v| v.as_f64().is_some_and(|n| (0.25..=16.0).contains(&n)))
            && request.get("duration_seconds").map_or(true, |v| v.as_f64().is_some_and(|n| (1.0..=36000.0).contains(&n)))
            && request.get("heartbeat_interval").map_or(true, |v| v.as_f64().is_some_and(|n| (0.01..=3600.0).contains(&n)))
            && request.get("instant_complete").map_or(true, |v| v.is_boolean()) => Ok(()),
        "ucampus.fabricated.pause" | "ucampus.fabricated.resume" | "ucampus.fabricated.stop"
            if request.get("graceful").is_none()
                && request.get("course_id").and_then(|v| v.as_str())
                    .is_some_and(|v| !v.is_empty() && v.len() <= 128
                        && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':' || b == b'+'))
                && request.get("run_id").and_then(|v| v.as_str())
                    .is_some_and(|id| id.len() == 32
                        && id.bytes().all(|b| b.is_ascii_hexdigit())) => Ok(()),
        "xuexitong.session.configure" if request.get("cookie").and_then(|v| v.as_str())
            .is_some_and(|value| !value.is_empty() && value.len() <= 8192
                && !value.contains('\r') && !value.contains('\n')) => Ok(()),
        "xuexitong.chapters.list" | "xuexitong.chapter.tasks" if request.get("course_id").and_then(|v| v.as_str())
            .is_some_and(|value| {
                let parts: Vec<&str> = value.split(':').collect();
                parts.len() == 3 && parts.iter().all(|part|
                    !part.is_empty() && part.len() <= 24
                    && part.bytes().all(|c| c.is_ascii_digit()))
            }) && (operation == "xuexitong.chapters.list"
                || request.get("chapter_id").and_then(|v| v.as_str()).is_some_and(|id|
                    !id.is_empty() && id.len() <= 24
                    && id.bytes().all(|c| c.is_ascii_digit()))) => Ok(()),
        "xuexitong.heartbeat.start" if request.get("course_id").and_then(|v| v.as_str())
            .is_some_and(|value| {
                let parts: Vec<&str> = value.split(':').collect();
                parts.len() == 3 && parts.iter().all(|part|
                    !part.is_empty() && part.len() <= 24
                    && part.bytes().all(|c| c.is_ascii_digit()))
            })
            && request.get("settings").map_or(true, |value| value.is_object())
            && request.get("dtype").map_or(true, |value|
                matches!(value.as_str(), Some("Video" | "Audio")))
            && request.get("speed").map_or(true, |v| v.as_f64().is_some_and(|n| (0.25..=2.0).contains(&n)))
            && request.get("jobs").map_or(true, |v| v.as_u64().is_some_and(|n| (1..=4).contains(&n))) => Ok(()),
        "xuexitong.heartbeat.status" if request.get("course_id").map_or(true, |v| v.as_str()
            .is_some_and(|key| key.len() <= 96 && {
                let parts: Vec<&str> = key.split(':').collect();
                parts.len() == 3 && parts.iter().all(|part|
                    !part.is_empty() && part.len() <= 24
                    && part.bytes().all(|c| c.is_ascii_digit()))
            })) => Ok(()),
        "xuexitong.heartbeat.logs" if request.get("limit").map_or(true, |v| v.as_u64()
            .is_some_and(|n| n <= 500))
            && request.get("course_id").map_or(true, |v| v.as_str()
                .is_some_and(|key| key.len() <= 96 && {
                    let parts: Vec<&str> = key.split(':').collect();
                    parts.len() == 3 && parts.iter().all(|part|
                        !part.is_empty() && part.len() <= 24
                        && part.bytes().all(|c| c.is_ascii_digit()))
                })) => Ok(()),
        "xuexitong.heartbeat.pause" | "xuexitong.heartbeat.resume" | "xuexitong.heartbeat.stop"
            if request.get("graceful").is_none()
                && request.get("run_id").and_then(|v| v.as_str()).is_some_and(|id|
                    !id.is_empty() && id.len() <= 64
                    && id.bytes().all(|c| c.is_ascii_hexdigit())) => Ok(()),
        "xuexitong.settings.save" if request.get("settings").and_then(|v| v.as_object())
            .is_some_and(|value| value.len() == 4
                && value.get("playback_speed").and_then(|v| v.as_f64()).is_some_and(|n| (0.25..=2.0).contains(&n))
                && value.get("concurrency").and_then(|v| v.as_u64()).is_some_and(|n| (1..=4).contains(&n))
                && value.get("skip_completed").and_then(|v| v.as_bool()).is_some()
                && value.get("verify_after_run").and_then(|v| v.as_bool()).is_some()) => Ok(()),
        "videos.list" if request.get("platform").and_then(|p| p.as_str()) == Some("yuketang") => Ok(()),
        "yuketang.course.detail" if request.get("course_id").and_then(|x| x.as_str())
            .is_some_and(|id| !id.is_empty() && id.len() <= 24 && id.bytes().all(|c| c.is_ascii_digit()))
            && request.get("offset").and_then(|x| x.as_u64()).is_some_and(|n| n <= 5000)
            && request.get("limit").and_then(|x| x.as_u64()).is_some_and(|n| (1..=12).contains(&n)) => Ok(()),

        "yuketang.progress" if request.get("run_id").and_then(|x| x.as_str())
            .is_some_and(|id| {
                let mut parts = id.split('-');
                matches!((parts.next(),parts.next(),parts.next()), (Some(a), Some(b), None)
                    if !a.is_empty() && a.len()<=15 && a.bytes().all(|ch| ch.is_ascii_digit())
                    && !b.is_empty() && b.len()<=20 && b.bytes().all(|ch| ch.is_ascii_digit()))
            }) => Ok(()),
        "yuketang.configure" if request.get("configuration").map_or(false, |x| x.is_object()) => Ok(()),
        "yuketang.scope.save" if request.get("scope").and_then(|x| x.as_object()).is_some_and(|scope|
            scope.keys().all(|key| matches!(key.as_str(), "classroom_id" | "university_id" | "sign"))
            && ["classroom_id", "university_id"].iter().all(|key| scope.get(*key).and_then(|x| x.as_str())
                .is_some_and(|id| !id.trim().is_empty() && id.trim().len()<=24 && id.trim().bytes().all(|ch| ch.is_ascii_digit())))
            && scope.get("sign").map_or(true, |value| value.as_str().is_some_and(|sign| sign.len()<=2048))) => Ok(()),
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
    let mut lines = stdout.split(|byte| *byte == b'\n')
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
    // QR, heartbeat and mastery exercise workflows must share a long-lived
    // Python process. Mastery start launches a background daemon thread and
    // its active exam/submit state lives in that process. If it were routed as
    // a one-shot request, child.wait_with_output() would close stdin and the
    // Python process would exit immediately, terminating the thread.
    let is_persistent = request.get("operation").and_then(|x| x.as_str())
        .map_or(false, |op| op.starts_with("zhidao.qr.")
                        || op.starts_with("zhidao.mastery.")
                        || op.starts_with("xuexitong.heartbeat.")
                        || op.starts_with("ucampus.heartbeat.")
                        || op.starts_with("ucampus.socket.")
                        || op.starts_with("ucampus.fabricated.")
                        || op.starts_with("ucampus.monitor.")
                        || matches!(op, "xuexitong.session.configure" | "xuexitong.session.clear"
                            | "ucampus.session.login" | "ucampus.session.configure" | "ucampus.session.clear"));
    if is_persistent {
        // These stateful operations share a single process and its
        // scheduler, answer draft, submission and QR state. Other operations
        // deliberately retain the one-shot behavior.
        let shared = app.state::<QrBridgeState>().inner().clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let mut slot = shared.lock().map_err(|_| "QR service lock failed")?;
            if slot.is_none() {
                *slot = Some(QrBridgeWorker::start(&binary)?);
            }
            let reply = slot.as_mut().ok_or("QR service unavailable")?
                .request(&message, &expected_id);
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

// Never accept an arbitrary browser URL from the renderer.
fn ucampus_official_url(mode: &str) -> Result<&'static str, String> {
    match mode {
        "ai" => Ok("https://uai.unipus.cn/"),
        "classic" => Ok("https://u.unipus.cn/"),
        "qr" => Ok("https://sso.unipus.cn/sso/login"),
        _ => Err("UCAMPUS_OFFICIAL_LINK_INVALID".into()),
    }
}

#[tauri::command]
fn ucampus_open_official_site(mode: String) -> Result<(), String> {
    let url = ucampus_official_url(&mode)?;
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map_err(|_| "UCAMPUS_OFFICIAL_SITE_OPEN_FAILED".to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("WINDOWS_ONLY".into())
    }
}

// Auth happens on the provider's actual site. The remote page is never given
// a Tauri capability, and tokens are exchanged only through native code/sidecar.
const UCAMPUS_AUTH_WINDOW: &str = "ucampus-official-auth";
const UCAMPUS_QR_WINDOW: &str = "ucampus-official-qr";

fn ucampus_login_window_target(mode: Option<&str>) -> Result<(&'static str, &'static str), String> {
    match mode.unwrap_or("ai") {
        "ai" => Ok((UCAMPUS_AUTH_WINDOW, "https://uai.unipus.cn/")),
        "qr" => Ok((UCAMPUS_QR_WINDOW, "https://sso.unipus.cn/sso/login")),
        _ => Err("UCAMPUS_LOGIN_MODE_INVALID".to_string()),
    }
}

fn ucampus_auth_destination_allowed(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(url.host_str(), Some(
            "sso.unipus.cn" | "uai.unipus.cn" | "ucontent.unipus.cn" |
            "ucloud.unipus.cn" | "passport.unipus.cn" | "birdflock.unipus.cn"
        ))
}

fn ucampus_jwt_cookie_shape(value: &str) -> bool {
    (10..=4096).contains(&value.len()) && value.split('.').count() == 3
        && value.split('.').all(|segment| !segment.is_empty() &&
            segment.as_bytes().iter().all(|byte|
                byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')))
}

// The JWT payload is an *untrusted* hint, never proof of authentication.
// Server acceptance is still checked by a separate read-only course request.
fn ucampus_jwt_cookie_expired(value: &str) -> bool {
    use base64::Engine as _;
    if !ucampus_jwt_cookie_shape(value) { return false; }
    let payload = value.split('.').nth(1).unwrap_or_default();
    let Ok(decoded) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload)
        else { return false; };
    if decoded.len() > 4096 { return false; }
    let Ok(claims) = serde_json::from_slice::<serde_json::Value>(&decoded)
        else { return false; };
    let Some(exp) = claims.get("exp").and_then(|value| value.as_i64())
        else { return false; };
    let Ok(now) = SystemTime::now().duration_since(UNIX_EPOCH) else { return false; };
    exp <= now.as_secs() as i64
}

fn ucampus_jwt_cookie_valid(value: &str) -> bool {
    ucampus_jwt_cookie_shape(value) && !ucampus_jwt_cookie_expired(value)
}

#[tauri::command]
async fn ucampus_login_window_start(app: tauri::AppHandle, mode: Option<String>) -> Result<(), String> {
    let (label, destination) = ucampus_login_window_target(mode.as_deref())?;
    // WebView2 initialization and show/focus can block on native work.
    // Run that work off the frontend IPC thread so a slow/failed QR page
    // cannot freeze the main StudyFlow window.
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if let Some(window) = app.get_webview_window(label) {
            window.show().map_err(|_| "UCAMPUS_LOGIN_WINDOW_UNAVAILABLE".to_string())?;
            window.set_focus().map_err(|_| "UCAMPUS_LOGIN_WINDOW_UNAVAILABLE".to_string())?;
            return Ok(());
        }
        let url = destination.parse()
            .map_err(|_| "UCAMPUS_LOGIN_WINDOW_UNAVAILABLE".to_string())?;
        let profile = app.path().app_local_data_dir()
            .map_err(|_| "UCAMPUS_LOGIN_WINDOW_UNAVAILABLE".to_string())?
            .join(label);
        tauri::WebviewWindowBuilder::new(
            &app, label, tauri::WebviewUrl::External(url))
            .title(if label == UCAMPUS_QR_WINDOW {
                "U校园 · 官方二维码登录"
            } else {
                "U校园 · 官方账号登录（图片/数字验证码）"
            })
            .inner_size(970.0, 710.0)
            .min_inner_size(660.0, 480.0)
            .data_directory(profile)
            .incognito(true)
            .on_navigation(ucampus_auth_destination_allowed)
            .build()
            .map_err(|_| "UCAMPUS_LOGIN_WINDOW_UNAVAILABLE".to_string())?;
        Ok(())
    }).await.map_err(|_| "UCAMPUS_LOGIN_WINDOW_UNAVAILABLE".to_string())?
}

#[tauri::command]
async fn ucampus_login_window_import(app: tauri::AppHandle, mode: Option<String>)
    -> Result<serde_json::Value, String> {
    let (label, _) = ucampus_login_window_target(mode.as_deref())?;
    let window = app.get_webview_window(label)
        .ok_or_else(|| "UCAMPUS_LOGIN_WINDOW_MISSING".to_string())?;
    // Windows WebView2 cookie access must not execute in a synchronous IPC
    // handler: Tauri documents a deadlock on the UI thread.
    let jwt = tauri::async_runtime::spawn_blocking(move || {
        let url: tauri::Url = "https://uai.unipus.cn/".parse()
            .map_err(|_| "UCAMPUS_LOGIN_COOKIE_UNAVAILABLE".to_string())?;
        let cookies = window.cookies_for_url(url)
            .map_err(|_| "UCAMPUS_LOGIN_COOKIE_UNAVAILABLE".to_string())?;
        let mut expired = false;
        for cookie in cookies.into_iter().filter(|cookie| cookie.name() == "jwt") {
            let value = cookie.value();
            if ucampus_jwt_cookie_valid(value) {
                return Ok(value.to_string());
            }
            expired |= ucampus_jwt_cookie_expired(value);
        }
        Err(if expired { "UCAMPUS_LOGIN_COOKIE_EXPIRED" } else {
            "UCAMPUS_LOGIN_COOKIE_MISSING" }.to_string())
    }).await.map_err(|_| "UCAMPUS_LOGIN_COOKIE_UNAVAILABLE".to_string())??;
    // No JWT/Cookie is sent to the frontend. It is forwarded solely to the
    // already validated local sidecar which persists into Credential Manager.
    let request = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(), "version": 1,
        "operation": "ucampus.session.configure",
        "configuration": {
            "variant": "ai", "catalog_url": "", "cookie": format!("jwt={jwt}"),
            "authorization": "", "annotator_token": "", "school_id": ""
        }
    });
    let reply = bridge_request(app.clone(), request).await
        .map_err(|_| "UCAMPUS_LOGIN_SAVE_FAILED".to_string())?;
    if reply.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err("UCAMPUS_LOGIN_SAVE_FAILED".to_string());
    }
    // Successful import must not leave another persistent copy of the
    // bearer token in the embedded browser profile.
    // Browser-data operations are synchronous on Windows/WebView2.
    // Never execute them directly on the asynchronous IPC/UI executor.
    if let Some(window) = app.get_webview_window(label) {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _ = window.clear_all_browsing_data();
            let _ = window.close();
        }).await;
    }
    Ok(serde_json::json!({"saved": true}))
}

#[tauri::command]
async fn ucampus_login_window_close(app: tauri::AppHandle, mode: Option<String>) -> Result<(), String> {
    let labels: Vec<&'static str> = match mode.as_deref() {
        None => vec![UCAMPUS_AUTH_WINDOW, UCAMPUS_QR_WINDOW],
        Some(value) => vec![ucampus_login_window_target(Some(value))?.0],
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        for label in labels {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.clear_all_browsing_data();
                window.close().map_err(|_| "UCAMPUS_LOGIN_WINDOW_UNAVAILABLE".to_string())?;
            }
        }
        Ok(())
    }).await.map_err(|_| "UCAMPUS_LOGIN_WINDOW_UNAVAILABLE".to_string())?
}

// An explicit Exit IPC command does not necessarily destroy the main window
// before the process exits. Stop only services owned by this instance first,
// so the next installer can replace the bundled bridge executable.
fn shutdown_owned_services(app: &tauri::AppHandle) {
    app.state::<legacy_tasks::LegacyTasks>().shutdown();
    app.state::<zhidao_player::ZhidaoPlayerManager>().shutdown();
    let qr_worker = app.state::<QrBridgeState>();
    if let Ok(mut guard) = qr_worker.lock() {
        if let Some(worker) = guard.as_mut() {
            // Flush heartbeat state before the child is killed.
            let _ = worker.request(
                b"{\"id\":\"hb-shutdown\",\"version\":1,\"operation\":\"xuexitong.heartbeat.stop\",\"graceful\":true}\n",
                "hb-shutdown",
            );
            let _ = worker.request(
                b"{\"id\":\"u-hb-shutdown\",\"version\":1,\"operation\":\"ucampus.heartbeat.stop\",\"graceful\":true}\n",
                "u-hb-shutdown",
            );
            let _ = worker.request(
                b"{\"id\":\"uf-hb-shutdown\",\"version\":1,\"operation\":\"ucampus.fabricated.stop\",\"graceful\":true}\n",
                "uf-hb-shutdown",
            );
        }
        guard.take();
    };
}

#[tauri::command]
fn studyflow_exit(app: tauri::AppHandle) {
    shutdown_owned_services(&app);
    app.exit(0);
}

fn studyflow_release_url(tag: Option<&str>) -> Result<String, String> {
    const BASE: &str = "https://github.com/07xh/StudyFlow/releases";
    let Some(tag) = tag else { return Ok(BASE.into()); };
    // Native boundary never accepts arbitrary URLs from React. Validate a
    // version-shaped tag and construct the official repository path ourselves.
    if tag.len() > 80 || !tag.starts_with('v') ||
       !tag.bytes().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'.' | b'-' | b'+')) {
        return Err("RELEASE_TAG_INVALID".into());
    }
    let numbered = tag[1..].split(['-', '+']).next().unwrap_or("");
    let segments: Vec<&str> = numbered.split('.').collect();
    if !(2..=4).contains(&segments.len()) ||
        !segments.iter().all(|part| !part.is_empty() && part.bytes().all(|ch| ch.is_ascii_digit())) {
        return Err("RELEASE_TAG_INVALID".into());
    }
    Ok(format!("{BASE}/tag/{tag}"))
}

#[tauri::command]
fn studyflow_open_releases(tag: Option<String>) -> Result<(), String> {
    let url = studyflow_release_url(tag.as_deref())?;
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map_err(|_| "RELEASE_PAGE_OPEN_FAILED".to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("WINDOWS_ONLY".into())
    }
}

/// Open the author's fixed homepage outside the application.
#[tauri::command]
fn studyflow_open_author_site() -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg("https://0701000.xyz/")
            .spawn()
            .map_err(|_| "AUTHOR_SITE_OPEN_FAILED".to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("WINDOWS_ONLY".into())
    }
}

#[tauri::command]
fn updates_open_folder() -> Result<(), String> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("WINDOWS_APPDATA_UNAVAILABLE")?;
    let folder = PathBuf::from(local).join("StudyFlow").join("updates");
    std::fs::create_dir_all(&folder).map_err(|_| "UPDATE_FOLDER_UNAVAILABLE")?;
    #[cfg(windows)]
    {
        Command::new("explorer.exe").arg(folder).spawn().map_err(|_| "UPDATE_FOLDER_UNAVAILABLE")?;
        Ok(())
    }
    #[cfg(not(windows))]
    { Err("WINDOWS_ONLY".into()) }
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

// Restore the existing renderer and its live IPC state; never open a second window.
fn show_main_from_tray(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(None::<QrBridgeWorker>)))
        .manage(legacy_tasks::LegacyTasks::default())
        .manage(zhidao_player::ZhidaoPlayerManager::default())
        .setup(|app| {
            // Built-in Windows tray; no OCS UI or second browser/HTTP listener.
            let show = MenuItem::with_id(app, "tray-show", "显示学序", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray-quit", "完全退出学序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let icon = app.default_window_icon().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "StudyFlow icon missing")
            })?.clone();
            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "tray-show" => show_main_from_tray(app),
                        "tray-quit" => {
                            shutdown_owned_services(app);
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }) {
                        show_main_from_tray(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge_request, launch_zhidao_legacy, zhidao_open_data_folder, zhidao_open_official_site, ucampus_open_official_site, ucampus_login_window_start, ucampus_login_window_import, ucampus_login_window_close, studyflow_exit, updates_open_folder, studyflow_open_releases, studyflow_open_author_site,
            studyflow_consent_status, studyflow_consent_accept, studyflow_read_document,
            zhidao_player::zhidao_player_prepare, zhidao_player::zhidao_player_start,
            zhidao_player::zhidao_player_status, zhidao_player::zhidao_player_stop,
            zhidao_player::zhidao_player_clear_web_profile,
            legacy_tasks::legacy_start, legacy_tasks::legacy_status, legacy_tasks::legacy_stop,
            legacy_tasks::zhs_queue_stop_video
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" { return; }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Hiding is not destroying: keep the same authenticated
                    // renderer and existing Sidecar alive while in the tray.
                    // The explicit tray Quit entry performs graceful cleanup.
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Destroyed => {
                    // Last-resort cleanup if the main WebView is actually
                    // destroyed by the OS or another native path.
                    shutdown_owned_services(window.app_handle());
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("Failed to launch StudyFlow");
}



#[cfg(test)]
mod ipc_validation_tests {
    use super::{parse_jsonl_reply, validate, studyflow_release_url, ucampus_official_url};
    use serde_json::json;

    #[test]
    fn official_release_navigation_only_accepts_version_tags() {
        assert_eq!(studyflow_release_url(None).unwrap(),
            "https://github.com/07xh/StudyFlow/releases");
        assert_eq!(studyflow_release_url(Some("v0.1.1-rc.25")).unwrap(),
            "https://github.com/07xh/StudyFlow/releases/tag/v0.1.1-rc.25");
        for unsafe_tag in ["https://evil.example", "../other", "rc.25", "v../../bad", "v1.2.3/evil", "v1.2@evil"] {
            assert!(studyflow_release_url(Some(unsafe_tag)).is_err());
        }
    }

    #[test]
    fn accepts_one_correlated_jsonl_reply() {
        let reply = parse_jsonl_reply(
            b"{\"id\":\"req-1\",\"ok\":true,\"data\":{}}\n",
            "req-1",
        ).unwrap();
        assert_eq!(reply["id"], "req-1");
        assert_eq!(reply["ok"], true);
    }

    #[test]
    fn rejects_stdout_noise_and_mismatched_jsonl_ids() {
        assert!(parse_jsonl_reply(
            b"debug output\n{\"id\":\"req-1\",\"ok\":true}\n",
            "req-1",
        ).is_err());
        assert!(parse_jsonl_reply(
            b"{\"id\":\"other\",\"ok\":true}\n",
            "req-1",
        ).is_err());
    }

    #[test]
    fn rejects_duplicate_or_untyped_jsonl_responses() {
        assert!(parse_jsonl_reply(
            b"{\"id\":\"req-1\",\"ok\":true}\n{\"id\":\"req-1\",\"ok\":true}\n",
            "req-1",
        ).is_err());
        assert!(parse_jsonl_reply(
            b"{\"id\":\"req-1\",\"ok\":\"true\"}\n",
            "req-1",
        ).is_err());
    }

    #[test]
    fn allows_zhidao_qr_lifecycle_operations() {
        for operation in ["zhidao.qr.start", "zhidao.qr.status", "zhidao.qr.cancel"] {
            let request = json!({"id":"qr-test","version":1,"operation":operation});
            assert!(validate(&request).is_ok(), "QR operation was rejected: {operation}");
        }
    }

    #[test]
    fn ucampus_auth_window_restricts_navigation_and_bearer_cookie() {
        assert!(super::ucampus_auth_destination_allowed(
            &"https://sso.unipus.cn/sso/login".parse().unwrap()));
        assert!(super::ucampus_auth_destination_allowed(
            &"https://uai.unipus.cn/".parse().unwrap()));
        assert_eq!(super::ucampus_login_window_target(Some("qr")).unwrap(),
            (super::UCAMPUS_QR_WINDOW, "https://sso.unipus.cn/sso/login"));
        assert_eq!(super::ucampus_login_window_target(None).unwrap().0,
            super::UCAMPUS_AUTH_WINDOW);
        assert!(super::ucampus_login_window_target(Some("external")).is_err());
        for url in [
            "https://evil.example/", "http://uai.unipus.cn/",
            "https://uai.unipus.cn.evil.example/",
            "https://uai.unipus.cn:444/", "https://user@uai.unipus.cn/"
        ] {
            assert!(!super::ucampus_auth_destination_allowed(&url.parse().unwrap()));
        }
        assert!(super::ucampus_jwt_cookie_valid("header.payload.signature"));
        // An expired JWT is never imported even if its shape is valid.
        use base64::Engine as _;
        let make = |expiry: i64| {
            let payload = format!(r#"{{"exp":{expiry}}}"#);
            let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload);
            format!("header.{encoded}.signature")
        };
        assert!(super::ucampus_jwt_cookie_expired(&make(1)));
        assert!(!super::ucampus_jwt_cookie_valid(&make(1)));
        assert!(!super::ucampus_jwt_cookie_expired(&make(4_102_444_800)));
        assert!(super::ucampus_jwt_cookie_valid(&make(4_102_444_800)));
        assert!(!super::ucampus_jwt_cookie_valid("jwt=header.payload.signature"));
        assert!(!super::ucampus_jwt_cookie_valid("header.payload.sig\\r\\nBad:1"));
    }

    #[test]
    fn ucampus_official_urls_are_constant_first_party_pages() {
        assert_eq!(ucampus_official_url("ai").unwrap(), "https://uai.unipus.cn/");
        assert_eq!(ucampus_official_url("classic").unwrap(), "https://u.unipus.cn/");
        assert_eq!(ucampus_official_url("qr").unwrap(), "https://sso.unipus.cn/sso/login");
        assert!(ucampus_official_url("https://evil.example/").is_err());
        assert!(ucampus_official_url("../").is_err());
    }

    #[test]
    fn ucampus_ipc_accepts_only_scoped_read_and_credential_operations() {
        for operation in ["ucampus.session.info", "ucampus.session.clear"] {
            assert!(validate(&json!({"id":"u","version":1,"operation":operation})).is_ok());
        }
        assert!(validate(&json!({"id":"u","version":1,"operation":"courses.list",
            "platform":"ucampus"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.session.configure","configuration":{
            "variant":"ai","catalog_url":"","cookie":"sid=test","authorization":"",
            "annotator_token":"local-token","school_id":"8320"}})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.session.login",
            "username":"student01","password":"example-password"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.monitor.status"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.monitor.tick"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.monitor.configure",
            "enabled":true,"course_id":"course-v2:abc+english+1","unit_id":"U1"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.monitor.configure",
            "enabled":false})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.monitor.configure",
            "enabled":true,"course_id":"../leak","unit_id":"U1"})).is_err());
        for invalid in [
            json!({"id":"u","version":1,"operation":"ucampus.session.login",
                "username":"","password":"secret"}),
            json!({"id":"u","version":1,"operation":"ucampus.session.login",
                "username":"student01","password":""}),
            json!({"id":"u","version":1,"operation":"ucampus.session.login",
                "username":"student01","password":"invalid\nheader"}),
        ] {
            assert!(validate(&invalid).is_err());
        }

        for config in [json!({}), json!({"variant":"ai","cookie":""}),
            json!({"variant":"unknown","cookie":"sid=test"}),
            json!({"variant":"ai","cookie":"bad\nheader"})] {
            assert!(validate(&json!({"id":"u","version":1,
                "operation":"ucampus.session.configure","configuration":config})).is_err());
        }
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.heartbeat.start",
            "course_id":"123"})).is_err());
    }

    #[test]
    fn ucampus_runtime_accepts_actual_plus_delimited_course_ids() {
        let course = "course-v2:75b7546ea002b72+nhce_v4_rw_2+20230116";
        // Identifiers in the real catalogue use '+' as a literal separator.
        // Status/history must accept the same scope that read-only units accept.
        for operation in [
            "ucampus.heartbeat.status",
            "ucampus.fabricated.status", "ucampus.fabricated.history",
        ] {
            assert!(validate(&json!({
                "id":"u", "version":1, "operation":operation, "course_id":course
            })).is_ok(), "real UCampus course id rejected for {operation}");
        }
        for operation in [
            "ucampus.heartbeat.start", "ucampus.fabricated.start",
        ] {
            assert!(validate(&json!({
                "id":"u", "version":1, "operation":operation,
                "course_id":course, "unit_id":"6566792c100159e",
                "pulses":6, "speed":1, "duration_seconds":600,
                "heartbeat_interval":20, "instant_complete":false
            })).is_ok(), "valid UCampus run parameters rejected for {operation}");
        }
        for operation in [
            "ucampus.heartbeat.pause", "ucampus.heartbeat.resume", "ucampus.heartbeat.stop",
            "ucampus.fabricated.pause", "ucampus.fabricated.resume", "ucampus.fabricated.stop"
        ] {
            assert!(validate(&json!({
                "id":"u", "version":1, "operation":operation,
                "course_id":course, "run_id":"0123456789abcdef0123456789abcdef"
            })).is_ok(), "valid UCampus lifecycle rejected for {operation}");
        }
        for bad in [
            "course-v2:../../etc", "course-v2:abc%2Fdef", "course-v2:abc?x=y",
            "course-v2:abc/def", "course-v2:abc#def",
        ] {
            for operation in ["ucampus.fabricated.status", "ucampus.heartbeat.status"] {
                assert!(validate(&json!({
                    "id":"u", "version":1, "operation":operation, "course_id":bad
                })).is_err());
            }
        }
    }

    #[test]
    fn ucampus_progress_reads_validate_resource_scope() {
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.units.list",
            "course_id":"course123"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.unit.tasks",
            "course_id":"course123","unit_id":"U-123"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.units.list",
            "course_id":"course-v2:real-course-id"})).is_ok());
        // Real U校园AI IDs contain literal '+' separators.
        let real_course = "course-v2:75b7546ea002b72+nhce_v4_rw_2+20230116";
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.units.list",
            "course_id":real_course})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.unit.tasks",
            "course_id":real_course,"unit_id":"U1"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.progress.verify",
            "course_id":real_course,"unit_id":"U1"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.progress.verify",
            "course_id":"course-v2:real-course-id","unit_id":"U-123"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.progress.verify",
            "course_id":"course-v2:real-course-id"})).is_err());
        assert!(validate(&json!({"id":"u","version":1,"operation":"ucampus.unit.tasks",
            "course_id":"course-v2:real-course-id","unit_id":"U-123"})).is_ok());
        for bad in [
            json!({"id":"u","version":1,"operation":"ucampus.units.list",
                "course_id":"../etc"}),
            json!({"id":"u","version":1,"operation":"ucampus.unit.tasks",
                "course_id":"course123","unit_id":"../other"}),
            json!({"id":"u","version":1,"operation":"ucampus.unit.tasks",
                "course_id":"course123"})
        ] {
            assert!(validate(&bad).is_err());
        }
    }

    #[test]
    fn ucampus_socket_diagnostics_has_no_untrusted_parameters() {
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.socket.diagnose"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.socket.send","course_id":"C1"})).is_err());
    }

    #[test]
    fn ucampus_heartbeat_operation_guard() {
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.heartbeat.start","course_id":"c1",
            "unit_id":"u1","pulses":5})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.heartbeat.start","course_id":"course-v2:real-course-id",
            "unit_id":"u1","pulses":5})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.heartbeat.start","course_id":"c1",
            "unit_id":"u1","pulses":101})).is_err());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.heartbeat.stop","course_id":"c1"})).is_err());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.heartbeat.pause","course_id":"c1",
            "run_id":"abcdef0123456789abcdef0123456789"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.heartbeat.stop","course_id":"c1",
            "run_id":"abcdef0123456789abcdef0123456789","graceful":true})).is_err());
    }

    #[test]
    fn ucampus_fabricated_operation_guard() {
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.fabricated.capabilities"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.fabricated.history","course_id":"course-v2:1"})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.fabricated.history"})).is_err());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.fabricated.start","course_id":"course-v2:1",
            "unit_id":"u1","pulses":6,"speed":2,"duration_seconds":600,
            "heartbeat_interval":20,"instant_complete":false})).is_ok());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.fabricated.start","course_id":"c1",
            "unit_id":"u1","speed":100})).is_err());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.fabricated.start","course_id":"c1",
            "unit_id":"u1","pulses":101})).is_err());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.fabricated.pause","course_id":"c1"})).is_err());
        assert!(validate(&json!({"id":"u","version":1,
            "operation":"ucampus.fabricated.stop","course_id":"c1",
            "run_id":"abcdef0123456789abcdef0123456789"})).is_ok());
    }

    #[test]
    fn xuexitong_controls_require_explicit_run_identity() {
        for operation in ["xuexitong.heartbeat.pause", "xuexitong.heartbeat.resume",
                          "xuexitong.heartbeat.stop"] {
            let mut request = json!({"id":"xxt-control","version":1,"operation":operation});
            assert!(validate(&request).is_err(), "unscoped control accepted: {operation}");
            request["run_id"] = json!("abcdef0123456789");
            assert!(validate(&request).is_ok(), "valid run id rejected: {operation}");
            request["graceful"] = json!(true);
            assert!(validate(&request).is_err(), "UI bypassed shutdown boundary: {operation}");
            request.as_object_mut().unwrap().remove("graceful");
            request["run_id"] = json!("old-run");
            assert!(validate(&request).is_err(), "non-hex run accepted: {operation}");
        }
    }

    #[test]
    fn xuexitong_logs_require_bounded_count_and_valid_course_scope() {
        let base = json!({"id":"xxt-log","version":1,
            "operation":"xuexitong.heartbeat.logs","limit":30,
            "course_id":"100001:200002:300003"});
        assert!(validate(&base).is_ok());
        let unscoped = json!({"id":"xxt-log","version":1,
            "operation":"xuexitong.heartbeat.logs","limit":30});
        assert!(validate(&unscoped).is_ok());
        for invalid in [
            json!({"id":"xxt-log","version":1,
                "operation":"xuexitong.heartbeat.logs","limit":501}),
            json!({"id":"xxt-log","version":1,
                "operation":"xuexitong.heartbeat.logs","limit":-1}),
            json!({"id":"xxt-log","version":1,
                "operation":"xuexitong.heartbeat.logs","course_id":"../other"}),
            json!({"id":"xxt-log","version":1,
                "operation":"xuexitong.heartbeat.logs","course_id":null}),
            json!({"id":"xxt-log","version":1,
                "operation":"xuexitong.heartbeat.logs","course_id":"1:2"}),
        ] {
            assert!(validate(&invalid).is_err(), "invalid log query accepted: {invalid}");
        }
    }

    #[test]
    fn yuketang_course_detail_validates_course_and_bounded_progress_pages() {
        let valid = json!({"id":"yp","version":1,"operation":"yuketang.course.detail",
            "course_id":"123","offset":0,"limit":8});
        assert!(validate(&valid).is_ok());
        for bad in [
            json!({"id":"yp","version":1,"operation":"yuketang.course.detail",
                "course_id":"../123","offset":0,"limit":8}),
            json!({"id":"yp","version":1,"operation":"yuketang.course.detail",
                "course_id":"123","offset":5001,"limit":8}),
            json!({"id":"yp","version":1,"operation":"yuketang.course.detail",
                "course_id":"123","offset":0,"limit":13}),
            json!({"id":"yp","version":1,"operation":"yuketang.course.detail",
                "course_id":"123","offset":0,"limit":true})
        ] {
            assert!(validate(&bad).is_err());
        }
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
    fn zhs_task_settings_ipc_accepts_global_or_valid_course_scopes() {
        let key = "a".repeat(64);
        for operation in ["zhidao.zhs.settings.get", "zhidao.zhs.settings.save"] {
            let mut request = json!({"id":"zhs","version":1,"operation":operation});
            if operation.ends_with(".save") { request["settings"] = json!({"speed":1.5}); }
            assert!(validate(&request).is_ok(), "global ZHS settings denied: {operation}");
            request["course_key"] = json!(key);
            assert!(validate(&request).is_ok(), "course ZHS settings denied: {operation}");
            for invalid in ["../invalid", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] {
                request["course_key"] = json!(invalid);
                assert!(validate(&request).is_err(), "invalid scope accepted: {operation}");
            }
        }
        assert!(validate(&json!({"id":"zhs","version":1,
            "operation":"zhidao.zhs.settings.save","course_key":key
        })).is_err(), "settings payload is required");
    }

    #[test]
    fn rejects_malformed_zhidao_course_keys_at_tauri_boundary() {
        for key in ["../invalid", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] {
            assert!(validate(&json!({"id":"c","version":1,"operation":"zhidao.progress.verify","course_key":key})).is_err());
        }
    }

    #[test]
    fn classroom_scope_operations_cannot_replace_credentials() {
        assert!(validate(&json!({"id":"scope","version":1,"operation":"yuketang.scope.get"})).is_ok());
        let mut request=json!({"id":"scope","version":1,"operation":"yuketang.scope.save","scope":{"classroom_id":"11","university_id":"22"}});
        assert!(validate(&request).is_ok());
        request["scope"]["sign"]=json!("");
        assert!(validate(&request).is_ok());
        request["scope"]["session_id"]=json!("replacement");
        assert!(validate(&request).is_err());
        request["scope"].as_object_mut().unwrap().remove("session_id");
        request["scope"]["classroom_id"]=json!("../invalid");
        assert!(validate(&request).is_err());
    }
}
