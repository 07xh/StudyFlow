use serde::Serialize;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Default)]
pub struct ZhidaoPlayerManager {
    job: Mutex<Option<ZhidaoPlayerJob>>,
}

struct ZhidaoPlayerJob {
    child: Option<Child>,
    state: String,
    exit_code: Option<i32>,
    token: String,
    course_key: String,
    local_appdata: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialPlayerStatus {
    state: String,
    course_key: Option<String>,
    exit_code: Option<i32>,
    event: Option<String>,
    position_seconds: Option<u64>,
    duration_seconds: Option<u64>,
    visible: Option<bool>,
    observed_at: Option<String>,
    message: String,
}

fn local_appdata() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA").ok_or("WINDOWS_APPDATA_UNAVAILABLE")?;
    Ok(PathBuf::from(base).join("StudyFlow").join("zhidao-player").join("LocalAppData"))
}

fn player_root(local: &Path) -> PathBuf {
    local.join("ZHSDesktop")
}

fn source_root(app: &AppHandle) -> Result<PathBuf, String> {
    let packaged = app.path().resource_dir()
        .map_err(|_| "PLAYER_RESOURCES_UNAVAILABLE")?
        .join("legacy").join("zhidao");
    if packaged.join("Official-Player.ps1").is_file() {
        return Ok(packaged);
    }
    if cfg!(debug_assertions) {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..").join("legacy").join("zhidao");
        if development.join("Official-Player.ps1").is_file() {
            return Ok(development);
        }
    }
    Err("PLAYER_RESOURCES_UNAVAILABLE".into())
}

fn copy_player_assets(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let local = local_appdata()?;
    let root = player_root(&local);
    fs::create_dir_all(&root).map_err(|_| "PLAYER_RUNTIME_UNAVAILABLE")?;
    let source = source_root(app)?;
    for name in ["Official-Player.ps1", "Official-MediaController.js", "Install-WebView2.ps1"] {
        let from = source.join(name);
        let to = root.join(name);
        if !from.is_file() {
            return Err("PLAYER_RESOURCES_UNAVAILABLE".into());
        }
        fs::copy(from, to).map_err(|_| "PLAYER_RUNTIME_UNAVAILABLE")?;
    }
    Ok((local, root))
}

fn webview_sdk_ready(root: &Path) -> bool {
    root.join("webview2").join("Microsoft.Web.WebView2.Core.dll").is_file()
        && root.join("webview2").join("Microsoft.Web.WebView2.Wpf.dll").is_file()
        && root.join("webview2").join("runtimes").join("win-x64").join("native")
            .join("WebView2Loader.dll").is_file()
}

fn prepare_runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let (local, root) = copy_player_assets(app)?;
    if webview_sdk_ready(&root) {
        return Ok((local, root));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(root.join("Install-WebView2.ps1"))
            .env("LOCALAPPDATA", &local)
            .current_dir(env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| root.clone()))
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|_| "WEBVIEW2_SDK_UNAVAILABLE")?;
        if !output.success() || !webview_sdk_ready(&root) {
            return Err("WEBVIEW2_SDK_UNAVAILABLE".into());
        }
        Ok((local, root))
    }
    #[cfg(not(windows))]
    {
        let _ = local;
        let _ = root;
        Err("WEBVIEW2_WINDOWS_ONLY".into())
    }
}

fn valid_course_key(value: &str) -> bool {
    value.len() == 64 && value.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn valid_decimal(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.bytes().all(|b| b.is_ascii_digit())
}

fn valid_route(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512
        && value.bytes().all(|b| b.is_ascii_alphanumeric() || b"_+./=:-".contains(&b))
}

fn read_observation(root: &Path, token: &str) -> (Option<String>, Option<u64>, Option<u64>, Option<bool>, Option<String>) {
    let path = root.join(format!("monitor-playback-{token}.json"));
    let Ok(metadata) = fs::metadata(&path) else { return (None, None, None, None, None); };
    if !metadata.is_file() || metadata.len() < 2 || metadata.len() > 2048 {
        return (None, None, None, None, None);
    }
    let Ok(modified) = metadata.modified() else { return (None, None, None, None, None); };
    let now = SystemTime::now();
    let age = now.duration_since(modified).unwrap_or(Duration::ZERO);
    if age > Duration::from_secs(18) {
        return (None, None, None, None, None);
    }
    let Ok(bytes) = fs::read(&path) else { return (None, None, None, None, None); };
    let Ok(data) = serde_json::from_slice::<Value>(&bytes) else { return (None, None, None, None, None); };
    if data.get("v").and_then(Value::as_u64) != Some(1)
        || data.get("token").and_then(Value::as_str) != Some(token) {
        return (None, None, None, None, None);
    }
    let event = data.get("event").and_then(Value::as_str).unwrap_or("");
    let allowed = ["observing", "advancing", "stalled", "paused", "buffering",
        "seeking", "position-jump", "sampling-gap", "visibility-changed", "ended"];
    if !allowed.contains(&event) {
        return (None, None, None, None, None);
    }
    let position = data.get("position").and_then(Value::as_u64);
    let duration = data.get("duration").and_then(Value::as_u64);
    if position.is_none_or(|n| n > 864000) || duration.is_none_or(|n| n > 864000) {
        return (None, None, None, None, None);
    }
    let visible = data.get("visible").and_then(Value::as_bool);
    let at = data.get("at").and_then(Value::as_str)
        .filter(|s| s.len() <= 64).map(str::to_owned);
    (Some(event.to_owned()), position, duration, visible, at)
}

fn event_message(event: Option<&str>) -> String {
    match event {
        Some("advancing") => "官方视频时间正在前进；这只是本机播放器观测".into(),
        Some("stalled") => "视频时间暂未前进，请检查缓冲或网页提示".into(),
        Some("paused") => "官方播放器已暂停".into(),
        Some("buffering") => "官方播放器正在缓冲".into(),
        Some("seeking") | Some("position-jump") => "检测到视频位置跳转，不代表连续观看".into(),
        Some("ended") => "本地视频已结束，等待服务器进度核验".into(),
        Some("visibility-changed") | Some("sampling-gap") => "播放窗口状态变化，正在重新观测".into(),
        Some("observing") => "已连接官方 HTML5 播放器观测".into(),
        _ => "等待官方网页视频状态".into(),
    }
}

fn status_of(job: &mut ZhidaoPlayerJob) -> OfficialPlayerStatus {
    if let Some(child) = job.child.as_mut() {
        if let Ok(Some(exit)) = child.try_wait() {
            job.exit_code = exit.code();
            job.state = "exited".into();
            job.child = None;
        }
    }
    let (event, position, duration, visible, at) = if job.state == "running" {
        read_observation(&player_root(&job.local_appdata), &job.token)
    } else {
        (None, None, None, None, None)
    };
    OfficialPlayerStatus {
        state: job.state.clone(),
        course_key: Some(job.course_key.clone()),
        exit_code: job.exit_code,
        event: event.clone(),
        position_seconds: position,
        duration_seconds: duration,
        visible,
        observed_at: at,
        message: if job.state == "running" {
            event_message(event.as_deref())
        } else if job.exit_code == Some(22) {
            "已切换系统浏览器；外部浏览器关闭时间无法自动观测".into()
        } else if job.state == "stopped" {
            "官方播放器已停止".into()
        } else {
            "官方播放器已关闭；可核验服务器课程记录".into()
        },
    }
}

fn kill_child(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let pid = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
pub async fn zhidao_player_prepare(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || prepare_runtime(&app).map(|_| true))
        .await.map_err(|_| "PLAYER_PREPARE_FAILED".to_string())?
}

#[tauri::command]
pub async fn zhidao_player_start(
    app: AppHandle,
    state: State<'_, ZhidaoPlayerManager>,
    course_key: String,
    speed: String,
    allow_minimize: bool,
    auto_start: bool,
    auto_next: bool,
) -> Result<OfficialPlayerStatus, String> {
    if !valid_course_key(&course_key) || !["1", "1.25", "1.5", "2"].contains(&speed.as_str()) {
        return Err("INVALID_PLAYER_REQUEST".into());
    }
    let request = json!({
        "id": format!("player-target-{}", Uuid::new_v4().simple()),
        "version": 1,
        "operation": "zhidao.player.target",
        "course_key": course_key,
    });
    let reply = super::bridge_request(app.clone(), request).await?;
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(match reply.get("error").and_then(Value::as_str) {
            Some("COURSE_NOT_FOUND") => "COURSE_NOT_FOUND",
            _ => "COURSE_ROUTE_UNAVAILABLE",
        }.into());
    }
    let target = reply.get("data").ok_or("COURSE_ROUTE_UNAVAILABLE")?;
    let course_type = target.get("course_type").and_then(Value::as_str).ok_or("COURSE_ROUTE_UNAVAILABLE")?;
    let course_id = target.get("course_id").and_then(Value::as_str).ok_or("COURSE_ROUTE_UNAVAILABLE")?;
    let class_id = target.get("class_id").and_then(Value::as_str).ok_or("COURSE_ROUTE_UNAVAILABLE")?;
    let route = target.get("recruit_and_course_id").and_then(Value::as_str).unwrap_or("");
    if !matches!(course_type, "ai" | "shared") || !valid_decimal(course_id) || !valid_decimal(class_id)
        || (course_type == "ai" && (course_id == "0" || class_id == "0"))
        || (course_type == "shared" && !valid_route(route)) {
        return Err("COURSE_ROUTE_UNAVAILABLE".into());
    }

    let app_for_prepare = app.clone();
    let (local, root) = tauri::async_runtime::spawn_blocking(move || prepare_runtime(&app_for_prepare))
        .await.map_err(|_| "PLAYER_PREPARE_FAILED".to_string())??;

    let mut guard = state.job.lock().map_err(|_| "PLAYER_STATE_UNAVAILABLE")?;
    if let Some(previous) = guard.as_mut() {
        let current = status_of(previous);
        if current.state == "running" {
            return Err("PLAYER_ALREADY_RUNNING".into());
        }
    }

    let token = Uuid::new_v4().simple().to_string();
    let script = root.join("Official-Player.ps1");
    #[cfg(windows)]
    let child = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(script)
            .args(["-CourseType", course_type, "-CourseId", course_id, "-ClassId", class_id,
                "-Speed", &speed, "-MonitorToken", &token]);
        if course_type == "shared" {
            command.args(["-RecruitAndCourseId", route]);
        }
        if allow_minimize { command.arg("-AllowMinimize"); }
        if auto_start { command.arg("-AutoStart"); }
        if auto_next { command.arg("-AutoNext"); }
        command.env("LOCALAPPDATA", &local)
            .current_dir(env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or(root.clone()))
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn().map_err(|_| "PLAYER_LAUNCH_FAILED")?
    };
    #[cfg(not(windows))]
    let child = {
        let _ = (script, course_type, course_id, class_id, route, local, root);
        return Err("WEBVIEW2_WINDOWS_ONLY".into());
    };

    *guard = Some(ZhidaoPlayerJob {
        child: Some(child), state: "running".into(), exit_code: None,
        token, course_key, local_appdata: local,
    });
    let job = guard.as_mut().ok_or("PLAYER_STATE_UNAVAILABLE")?;
    Ok(status_of(job))
}

#[tauri::command]
pub fn zhidao_player_status(state: State<'_, ZhidaoPlayerManager>) -> Result<OfficialPlayerStatus, String> {
    let mut guard = state.job.lock().map_err(|_| "PLAYER_STATE_UNAVAILABLE")?;
    match guard.as_mut() {
        Some(job) => Ok(status_of(job)),
        None => Ok(OfficialPlayerStatus {
            state: "idle".into(), course_key: None, exit_code: None,
            event: None, position_seconds: None, duration_seconds: None,
            visible: None, observed_at: None, message: "官方播放器尚未启动".into(),
        }),
    }
}

#[tauri::command]
pub fn zhidao_player_stop(state: State<'_, ZhidaoPlayerManager>) -> Result<OfficialPlayerStatus, String> {
    let mut guard = state.job.lock().map_err(|_| "PLAYER_STATE_UNAVAILABLE")?;
    let Some(job) = guard.as_mut() else {
        return Ok(OfficialPlayerStatus {
            state: "idle".into(), course_key: None, exit_code: None,
            event: None, position_seconds: None, duration_seconds: None,
            visible: None, observed_at: None, message: "官方播放器尚未启动".into(),
        });
    };
    if let Some(mut child) = job.child.take() {
        kill_child(&mut child);
        job.state = "stopped".into();
        job.exit_code = None;
        let _ = fs::remove_file(player_root(&job.local_appdata).join(format!("monitor-playback-{}.json", job.token)));
    }
    Ok(status_of(job))
}

fn is_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn remove_owned_tree(path: &Path) -> Result<usize, String> {
    if !path.exists() {
        return Ok(0);
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| "WEBVIEW_PROFILE_CLEAR_FAILED")?;
    if is_reparse(&metadata) || !metadata.is_dir() {
        return Err("WEBVIEW_PROFILE_UNSAFE".into());
    }
    let mut removed = 0usize;
    for entry in fs::read_dir(path).map_err(|_| "WEBVIEW_PROFILE_CLEAR_FAILED")? {
        let entry = entry.map_err(|_| "WEBVIEW_PROFILE_CLEAR_FAILED")?;
        let child = entry.path();
        let child_meta = fs::symlink_metadata(&child).map_err(|_| "WEBVIEW_PROFILE_CLEAR_FAILED")?;
        if is_reparse(&child_meta) {
            return Err("WEBVIEW_PROFILE_UNSAFE".into());
        }
        if child_meta.is_dir() {
            removed += remove_owned_tree(&child)?;
        } else {
            fs::remove_file(&child).map_err(|_| "WEBVIEW_PROFILE_CLEAR_FAILED")?;
            removed += 1;
        }
    }
    fs::remove_dir(path).map_err(|_| "WEBVIEW_PROFILE_CLEAR_FAILED")?;
    Ok(removed)
}

#[tauri::command]
pub fn zhidao_player_clear_web_profile(
    state: State<'_, ZhidaoPlayerManager>,
) -> Result<usize, String> {
    let mut guard = state.job.lock().map_err(|_| "PLAYER_STATE_UNAVAILABLE")?;
    if let Some(job) = guard.as_mut() {
        if status_of(job).state == "running" {
            return Err("PLAYER_RUNNING".into());
        }
    }
    let local = local_appdata()?;
    let profile = player_root(&local).join("official-webview-profile");
    remove_owned_tree(&profile)
}

impl ZhidaoPlayerManager {
    pub(crate) fn shutdown(&self) {
        if let Ok(mut guard) = self.job.lock() {
            if let Some(job) = guard.as_mut() {
                if let Some(mut child) = job.child.take() {
                    kill_child(&mut child);
                    job.state = "stopped".into();
                }
                let _ = fs::remove_file(player_root(&job.local_appdata)
                    .join(format!("monitor-playback-{}.json", job.token)));
            }
        }
    }
}
