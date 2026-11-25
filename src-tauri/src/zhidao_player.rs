use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::State;

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
    run_id: Option<String>,
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
    if position.map_or(true, |n| n > 864000) || duration.map_or(true, |n| n > 864000) {
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
        run_id: Some(job.token.clone()),
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
        } else if job.exit_code == Some(0) {
            "官方播放器已关闭；可核验服务器课程记录".into()
        } else {
            format!("官方播放器异常退出（退出码 {}）；请检查网页或 WebView2，学习记录以服务器为准", job.exit_code.map_or("未知".into(), |code| code.to_string()))
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
pub fn zhidao_player_status(state: State<'_, ZhidaoPlayerManager>) -> Result<OfficialPlayerStatus, String> {
    let mut guard = state.job.lock().map_err(|_| "PLAYER_STATE_UNAVAILABLE")?;
    match guard.as_mut() {
        Some(job) => Ok(status_of(job)),
        None => Ok(OfficialPlayerStatus {
            state: "idle".into(), course_key: None, run_id: None, exit_code: None,
            event: None, position_seconds: None, duration_seconds: None,
            visible: None, observed_at: None, message: "官方播放器尚未启动".into(),
        }),
    }
}

#[tauri::command]
pub fn zhidao_player_stop(state: State<'_, ZhidaoPlayerManager>, expected_run_id: Option<String>) -> Result<OfficialPlayerStatus, String> {
    let mut guard = state.job.lock().map_err(|_| "PLAYER_STATE_UNAVAILABLE")?;
    let Some(job) = guard.as_mut() else {
        return Ok(OfficialPlayerStatus {
            state: "idle".into(), course_key: None, run_id: None, exit_code: None,
            event: None, position_seconds: None, duration_seconds: None,
            visible: None, observed_at: None, message: "官方播放器尚未启动".into(),
        });
    };
    crate::run_identity::verify_expected_run(expected_run_id.as_deref(), Some(job.token.as_str()))
        .map_err(|code| code.to_owned())?;
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
