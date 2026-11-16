//! Process-only integration of the original ZHS and Rain Classroom executors.
//! Their heartbeat generators, senders, defaults and upstream source are unchanged.
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use serde::Serialize;
use tauri::{AppHandle, Manager};

// Windows Job Objects own the exact child-process tree created by StudyFlow.
// KILL_ON_JOB_CLOSE also releases descendant workers after an unexpected app exit.
// Unrelated ZHS instances are never terminated.
#[cfg(windows)]
mod process_job {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // HANDLE is OS-wide, not tied to a Rust thread. Keeping it as usize allows
    // the guarded LegacyTasks state to move between Tauri worker threads.
    pub(super) struct WindowsJob(usize);

    impl WindowsJob {
        pub(super) fn attach(child: &Child) -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() { return None; }
                let job = Self(handle as usize);
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(handle, JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const c_void,
                    std::mem::size_of_val(&limits) as u32) == 0 {
                    return None;
                }
                if AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) == 0 {
                    // Some Windows environments forbid nested jobs. Preserve the
                    // original PID-scoped taskkill fallback rather than abort launch.
                    return None;
                }
                Some(job)
            }
        }

        pub(super) fn terminate(&self) -> bool {
            unsafe { TerminateJobObject(self.0 as HANDLE, 1) != 0 }
        }
    }

    impl Drop for WindowsJob {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0 as HANDLE); }
        }
    }
}
#[cfg(windows)]
use process_job::WindowsJob;

#[derive(serde::Deserialize)]
pub struct OriginalYktOptions {
    video_speed: f64,
    heartbeat_interval: u32,
    max_concurrent_videos: u8,
    completion_threshold: u8,
    skip_completed: bool,
    use_concurrent: bool,
    test_mode: bool,
    test_video_count: u32,
    auto_richtext: bool,
    debug: bool,
    richtext_stay_seconds: u32,
    richtext_skip_delay: f64,
}

impl OriginalYktOptions {
    fn validate(&self) -> Result<(), String> {
        if !self.video_speed.is_finite() || self.video_speed < 0.1 || self.video_speed > 4.0
            || self.heartbeat_interval < 1 || self.heartbeat_interval > 120
            || self.max_concurrent_videos < 1 || self.max_concurrent_videos > 32
            || self.completion_threshold > 100
            || self.test_video_count < 1 || self.test_video_count > 10000
            || self.richtext_stay_seconds > 3600
            || !self.richtext_skip_delay.is_finite()
            || self.richtext_skip_delay < 0.0 || self.richtext_skip_delay > 3600.0 {
            return Err("INVALID_SETTINGS".into());
        }
        Ok(())
    }

    fn apply(&self, command: &mut Command) {
        // Original main.py still owns all defaults, event creation and sending.
        command.env("VIDEO_SPEED", self.video_speed.to_string());
        command.env("HEARTBEAT_INTERVAL", self.heartbeat_interval.to_string());
        command.env("MAX_CONCURRENT_VIDEOS", self.max_concurrent_videos.to_string());
        command.env("COMPLETION_THRESHOLD", self.completion_threshold.to_string());
        command.env("SKIP_COMPLETED", if self.skip_completed { "true" } else { "false" });
        command.env("USE_CONCURRENT", if self.use_concurrent { "true" } else { "false" });
        command.env("TEST_MODE", if self.test_mode { "true" } else { "false" });
        command.env("TEST_VIDEO_COUNT", self.test_video_count.to_string());
        command.env("AUTO_RICHTEXT", if self.auto_richtext { "true" } else { "false" });
        command.env("DEBUG", if self.debug { "true" } else { "false" });
        command.env("RICHTEXT_STAY_SECONDS", self.richtext_stay_seconds.to_string());
        command.env("RICHTEXT_SKIP_DELAY", self.richtext_skip_delay.to_string());
    }
}

// CLI playback options plus StudyFlow's isolated per-video process scheduler.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct ZhsOptions {
    speed: f64,
    speed_cap: f64,
    limit_minutes: u16,
    learn_optional: bool,
    max_videos: u16,
    stop_on_error: bool,
    // Per-course local target. None preserves ZHS's course-type default.
    #[serde(default)]
    completion_threshold: Option<u8>,
    scope_mode: String,
    selected_ids: Vec<u64>,
    #[serde(default = "default_zhs_resource_mode")]
    resource_mode: String,
    #[serde(default = "default_zhs_concurrency")]
    concurrency: u8,
}
fn default_zhs_resource_mode() -> String { "all".into() }
fn default_zhs_concurrency() -> u8 { 1 }
impl ZhsOptions {
    fn validate(&self) -> Result<(), String> {
        if !self.speed.is_finite() || self.speed < 1.0 || self.speed > 2.0
            || !self.speed_cap.is_finite() || self.speed_cap < 1.0 || self.speed_cap > 2.0
            || self.limit_minutes > 1440 || self.max_videos > 1000
            || !(1..=3).contains(&self.concurrency)
            || self.completion_threshold.is_some_and(|value| value == 0 || value > 100)
            || !matches!(self.resource_mode.as_str(), "all" | "video" | "reading")
            || (self.scope_mode != "all" && self.scope_mode != "selected")
            || self.selected_ids.len() > 256
            || (self.scope_mode == "all" && !self.selected_ids.is_empty())
            || (self.scope_mode == "selected" && self.selected_ids.is_empty())
            || self.selected_ids.iter().any(|id| *id == 0 || *id > i64::MAX as u64)
            || {
                let ids: std::collections::HashSet<_> = self.selected_ids.iter().collect();
                ids.len() != self.selected_ids.len()
            } {
            return Err("INVALID_SETTINGS".into());
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct LegacyTasks {
    jobs: Mutex<HashMap<String, LegacyJob>>,
}

struct LegacyJob {
    child: Option<Child>,
    #[cfg(windows)]
    process_job: Option<WindowsJob>,
    state: String,
    exit_code: Option<i32>,
    run_id: Option<String>,
    course_id: Option<String>, // opaque course key, never a raw login credential
    monitor_token: Option<String>, // per-run nonce, kept out of frontend
    last_zhs_progress: Option<ZhsProgress>, // last real numeric observation, never server-confirmed
    last_diagnostic_code: Option<String>, // fixed enum only; no raw child output
    last_zhs_queue: Option<crate::zhs_queue::QueueSnapshot>,
}

#[derive(Clone, Serialize)]
pub struct ZhsProgress {
    video_segment_percent: Option<f64>,
    resource_index: Option<u64>,
    resource_total: Option<u64>,
    resource_kind: Option<String>,
    resource_name: Option<String>,
}

/// The last *identified* resource may remain visible when telemetry is stale.
#[derive(Clone, Serialize)]
pub struct ZhsResourceContext {
    resource_index: Option<u64>,
    resource_total: Option<u64>,
    resource_kind: Option<String>,
    resource_name: Option<String>,
}
#[derive(Serialize)]
pub struct LegacyStatus {
    platform: String,
    state: String,
    exit_code: Option<i32>,
    run_id: Option<String>,
    course_id: Option<String>,
    zhs_progress: Option<ZhsProgress>,
    zhs_last_resource: Option<ZhsResourceContext>,
    zhs_stale: bool, // Last sample expired while the process is still running.
    diagnostic_code: Option<String>, // bounded local failure category, not progress
    zhs_queue: Option<crate::zhs_queue::QueueSnapshot>,
}

fn zhs_snapshot_path(token: &str) -> Option<PathBuf> {
    if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
        return None;
    }
    let local = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(local).join("StudyFlow").join(format!("monitor-zhs-{token}.json")))
}

fn zhs_diagnostic_path(token: &str) -> Option<PathBuf> {
    // Use the same strict random nonce validation as numeric progress snapshots.
    let root = zhs_snapshot_path(token)?.parent()?.to_path_buf();
    Some(root.join(format!("zhs-diagnostic-{token}.json")))
}

fn remove_zhs_diagnostic(token: Option<&str>) {
    if let Some(path) = token.and_then(zhs_diagnostic_path) {
        let _ = fs::remove_file(path);
    }
}

/// Read only an allowlisted category. Never read or forward traceback text.
fn parse_zhs_diagnostic(bytes: &[u8], token: &str, now: f64) -> Option<String> {
    if bytes.len() > 512 { return None; }
    let data: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    if data.get("v")?.as_u64()? != 1 || data.get("token")?.as_str()? != token {
        return None;
    }
    let at = data.get("at")?.as_f64()?;
    if !at.is_finite() || at > now + 10.0 || now - at > 120.0 {
        return None;
    }
    let code = data.get("code")?.as_str()?;
    if !matches!(code,
        "CAPTCHA_REQUIRED" | "TIME_RESTRICTED" | "LOGIN_REQUIRED"
        | "NETWORK_ERROR" | "LOCAL_FILE_MISSING" | "FILE_PERMISSION_DENIED"
        | "INTERACTIVE_INPUT_REQUIRED" | "UPSTREAM_NONZERO_EXIT"
        | "EXECUTOR_EXCEPTION" | "WORKER_ENTRY_EXCEPTION"
        | "ZHS_SESSION_PREFLIGHT_FAILED" | "ZHS_COURSE_URL_FAILED"
        | "ZHS_COOKIE_RESTORE_FAILED" | "ZHS_SESSION_EXPIRED"
        | "ZHS_SESSION_UNAVAILABLE") {
        return None;
    }
    Some(code.to_owned())
}

fn read_zhs_diagnostic(token: &str) -> Option<String> {
    let path = zhs_diagnostic_path(token)?;
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() < 2 || metadata.len() > 512 { return None; }
    let bytes = fs::read(path).ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs_f64();
    parse_zhs_diagnostic(&bytes, token, now)
}

fn remove_zhs_snapshot(token: Option<&str>) {
    if let Some(path) = token.and_then(zhs_snapshot_path) {
        let _ = fs::remove_file(path);
    }
}

/// Parse only bounded, fresh, per-process numeric telemetry from the unchanged observer.
/// Never mistake local simulated progress for confirmed platform learning progress.
fn read_zhs_snapshot(token: &str) -> Option<ZhsProgress> {
    let path = zhs_snapshot_path(token)?;
    // Do not follow local telemetry symlinks.
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() < 2 || metadata.len() > 2048 {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let data: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    if data.get("v")?.as_u64()? != 1 || data.get("token")?.as_str()? != token {
        return None;
    }
    let observed = data.get("at")?.as_f64()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs_f64();
    if !observed.is_finite() || observed > now + 10.0 || now - observed > 18.0 {
        return None;
    }
    let raw_percent = data.get("videoSegmentPercent")?;
    let percent = if raw_percent.is_null() { None } else {
        let value = raw_percent.as_f64()?;
        if !value.is_finite() || !(0.0..=100.0).contains(&value) { return None; }
        Some(value)
    };
    let raw_index = data.get("resourceIndex")?;
    let raw_total = data.get("resourceTotal")?;
    let (index, total) = if raw_index.is_null() && raw_total.is_null() {
        (None, None)
    } else {
        let i = raw_index.as_u64()?;
        let t = raw_total.as_u64()?;
        if i < 1 || t < i || t > 100000 { return None; }
        (Some(i), Some(t))
    };
    // These fields are sourced from the original ZHS resource model, never
    // from raw console stderr. Reject malformed or unbounded local data.
    let kind = match data.get("resourceKind") {
        None | Some(serde_json::Value::Null) => None,
        Some(raw) => {
            let value = raw.as_str()?;
            if !matches!(value, "video" | "ppt" | "article" | "other") { return None; }
            Some(value.to_owned())
        }
    };
    let name = match data.get("resourceName") {
        None | Some(serde_json::Value::Null) => None,
        Some(raw) => {
            let value = raw.as_str()?;
            if value.is_empty() || value.chars().count() > 90 || value.chars().any(char::is_control)
                || value.contains('@') || value.contains('=') ||
                ["http:", "https:", "cookie", "token", "authorization", "password", "secret", "apikey", "api_key"]
                    .iter().any(|marker| value.to_lowercase().contains(marker)) {
                return None;
            }
            Some(value.to_owned())
        }
    };
    if percent.is_none() && index.is_none() && kind.is_none() { return None; }
    Some(ZhsProgress {
        video_segment_percent: percent, resource_index: index, resource_total: total,
        resource_kind: kind, resource_name: name,
    })
}

fn status_of(platform: &str, task: &mut LegacyJob) -> Result<LegacyStatus, String> {
    // Check process exit first, then read the atomic numeric snapshot. If the
    // child finished between polls, its final write is now complete and can be
    // captured before the snapshot is removed. No server-completion inference.
    let exit_status = match task.child.as_mut() {
        Some(child) => child.try_wait().map_err(|_| "TASK_STATUS_FAILED")?,
        None => None,
    };
    let mut fresh_zhs_progress = None;
    if platform == "zhidao" && task.state == "running" {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0);
        if let Some(queue) = task.monitor_token.as_deref().and_then(|token| crate::zhs_queue::read(token, now)) {
            task.last_zhs_queue = Some(queue);
        } else if let Some(queue) = task.last_zhs_queue.as_mut() {
            queue.stale = true;
            for row in &mut queue.tasks { row.stale = true; row.percent = None; }
        }
        fresh_zhs_progress = task.monitor_token.as_deref().and_then(read_zhs_snapshot);
        if let Some(observation) = fresh_zhs_progress.as_ref() {
            task.last_zhs_progress = Some(observation.clone());
        }
    }
    if let Some(code) = exit_status {
        task.exit_code = code.code();
        task.last_diagnostic_code = task.monitor_token.as_deref().and_then(read_zhs_diagnostic);
        task.state = "exited".into();
        task.child = None;
        #[cfg(windows)]
        { task.process_job = None; } // closes the job and any surviving descendants
        remove_zhs_snapshot(task.monitor_token.as_deref());
        remove_zhs_diagnostic(task.monitor_token.as_deref());
        if let Some(token) = task.monitor_token.as_deref() { crate::zhs_queue::cleanup(token); }
    }
    // A cached final frame must not masquerade as live progress.
    let running = task.state == "running";
    let zhs_stale = platform == "zhidao" && running
        && fresh_zhs_progress.is_none() && task.last_zhs_progress.is_some();
    // Expose stale resource identity separately, never the old numeric
    // percentage. The UI labels it as last recognized, not now playing.
    let zhs_last_resource = if zhs_stale {
        task.last_zhs_progress.as_ref().map(|last| ZhsResourceContext {
            resource_index: last.resource_index,
            resource_total: last.resource_total,
            resource_kind: last.resource_kind.clone(),
            resource_name: last.resource_name.clone(),
        })
    } else { None };
    let zhs_progress = if platform != "zhidao" {
        None
    } else if running {
        fresh_zhs_progress
    } else if task.state == "exited" {
        task.last_zhs_progress.clone()
    } else {
        None
    };
    Ok(LegacyStatus {
        platform: platform.into(),
        state: task.state.clone(),
        exit_code: task.exit_code,
        run_id: task.run_id.clone(),
        course_id: task.course_id.clone(),
        zhs_progress,
        zhs_last_resource,
        zhs_stale,
        diagnostic_code: if task.state == "exited" { task.last_diagnostic_code.clone() } else { None },
        zhs_queue: task.last_zhs_queue.clone().map(|mut queue| {
            if task.state != "running" {
                queue.state = task.state.clone();
                for row in &mut queue.tasks {
                    if matches!(row.state.as_str(), "queued" | "running") {
                        row.state = if task.state == "stopped" { "stopped" } else { "unknown" }.into();
                        row.percent = None;
                    }
                }
            }
            queue
        }),
    })
}

fn terminate_tree(child: &mut Child, #[cfg(windows)] process_job: Option<&WindowsJob>) -> Result<(), String> {
    #[cfg(windows)]
    {
        // The Job Object covers spawned descendants even when the initial
        // sidecar has already exited. Use PID-scoped taskkill as a fallback.
        let stopped_by_job = process_job.is_some_and(WindowsJob::terminate);
        if !stopped_by_job {
            use std::os::windows::process::CommandExt;
            let result = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .stdout(Stdio::null()).stderr(Stdio::null()).status()
                .map_err(|_| "TASK_STOP_FAILED".to_owned())?;
            // Never report 'stopped' after a failed taskkill.
            if !result.success() { return Err("TASK_STOP_FAILED".into()); }
        }
        child.wait().map_err(|_| "TASK_STOP_FAILED".to_owned())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if child.try_wait().map_err(|_| "TASK_STOP_FAILED".to_owned())?.is_none() {
            child.kill().map_err(|_| "TASK_STOP_FAILED".to_owned())?;
        }
        child.wait().map_err(|_| "TASK_STOP_FAILED".to_owned())?;
        Ok(())
    }
}

impl LegacyTasks {
    pub(crate) fn shutdown(&self) {
        if let Ok(mut guard) = self.jobs.lock() {
            for (_, task) in guard.iter_mut() {
                if let Some(mut child) = task.child.take() {
                    #[cfg(windows)]
                    let finished = terminate_tree(&mut child, task.process_job.as_ref()).is_ok();
                    #[cfg(not(windows))]
                    let finished = terminate_tree(&mut child).is_ok();
                    if finished {
                        task.state = "stopped".into();
                    } else {
                        // Preserve the prior last-resort shutdown behavior.
                        // This only targets the exact child owned by this app;
                        // the Job Object, when available, closes below.
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                #[cfg(windows)]
                { task.process_job = None; } // guaranteed kill on close if the fallback failed
                remove_zhs_snapshot(task.monitor_token.as_deref());
                remove_zhs_diagnostic(task.monitor_token.as_deref());
                if let Some(token) = task.monitor_token.as_deref() { crate::zhs_queue::cleanup(token); }
            }
        }
    }
}

/// ZHS 0.1.5 resolves .zhs/ relative to the child working directory.
/// Use the same home path as existing read-only Zhidao workers.
fn configure_zhidao_workdir(command: &mut Command, user_home: &std::path::Path) {
    command.current_dir(user_home);
}

fn valid_course_key(key: &str) -> bool {
    key.len() == 64 && key.as_bytes().iter().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

// Windows process creation is blocking: always run it off the Tauri IPC thread.
#[tauri::command]
pub async fn legacy_start(
    app: AppHandle,
    platform: String, course_id: Option<String>, options: Option<OriginalYktOptions>,
    zhs_options: Option<ZhsOptions>
) -> Result<LegacyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LegacyTasks>();
        legacy_start_blocking(&app, state.inner(), platform, course_id, options, zhs_options)
    }).await.map_err(|_| "TASK_START_FAILED".to_string())?
}

fn legacy_start_blocking(
    app: &AppHandle, state: &LegacyTasks,
    platform: String, course_id: Option<String>, options: Option<OriginalYktOptions>,
    zhs_options: Option<ZhsOptions>
) -> Result<LegacyStatus, String> {
    if platform != "zhidao" && platform != "yuketang" {
        return Err("UNKNOWN_PLATFORM".into());
    }
    if platform == "zhidao" && !course_id.as_deref().is_some_and(valid_course_key) {
        return Err("INVALID_COURSE".into());
    }
    if platform == "yuketang" && course_id.is_some() {
        return Err("INVALID_REQUEST".into());
    }
    if (platform == "zhidao" && options.is_some())
        || (platform == "yuketang" && zhs_options.is_some()) {
        return Err("INVALID_REQUEST".into());
    }
    if let Some(settings) = &options {
        settings.validate()?;
    }
    if let Some(settings) = &zhs_options {
        settings.validate()?;
    }
    let mut guard = state.jobs.lock().map_err(|_| "TASK_STATE_UNAVAILABLE")?;
    if let Some(previous) = guard.get_mut(&platform) {
        if status_of(&platform, previous)?.state == "running" {
            return Err("TASK_ALREADY_RUNNING".into());
        }
    }
    let binary = crate::bridge_binary(app).map_err(|_| "LEGACY_NOT_INSTALLED")?;
    let mut command = Command::new(binary);
    let run_id = if platform == "yuketang" {
        let micros = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "LEGACY_LAUNCH_FAILED")?.as_micros();
        Some(format!("{}-{micros}", std::process::id()))
    } else { Some(Uuid::new_v4().to_string()) };
    let monitor_token = if platform == "zhidao" {
        Some(Uuid::new_v4().simple().to_string())
    } else { None };
    if platform == "zhidao" {
        let home = app.path().home_dir().map_err(|_| "LEGACY_LAUNCH_FAILED")?;
        configure_zhidao_workdir(&mut command, &home);
        command.arg("--legacy-zhidao")
            .arg(course_id.as_deref().unwrap_or(""))
            .arg(monitor_token.as_deref().unwrap_or(""));
        if let Some(settings) = &zhs_options {
            command.arg(serde_json::to_string(settings).map_err(|_| "INVALID_SETTINGS")?);
        }
    } else {
        command.arg("--legacy-yuketang");
        if let Some(ref id) = run_id { command.env("STUDYFLOW_YKT_RUN_ID", id); }
        if let Some(settings) = &options {
            settings.apply(&mut command);
        }
        // Validated per-classroom IPC values win. Without IPC options, old
        // persisted global 90% must not silently skip an incomplete video.
        if options.is_none() {
            command.env("COMPLETION_THRESHOLD", "100");
        }
    }
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let child = command.spawn().map_err(|_| "LEGACY_LAUNCH_FAILED")?;
    #[cfg(windows)]
    let process_job = WindowsJob::attach(&child);
    let wallclock_limit = if platform == "zhidao" {
        zhs_options.as_ref().map(|x| x.limit_minutes).unwrap_or(0)
    } else { 0 };
    guard.insert(platform.clone(), LegacyJob {
        child: Some(child),
        #[cfg(windows)]
        process_job,
        state: "running".into(), exit_code: None,
        run_id: run_id.clone(),
        course_id: if platform == "zhidao" { course_id.clone() } else { None },
        monitor_token,
        last_zhs_progress: None,
        last_diagnostic_code: None,
        last_zhs_queue: None,
    });
    if wallclock_limit > 0 {
        // Dedicated timer enforces the cap even when the UI is minimized or not polling.
        // It never owns a heartbeat generator; it only stops this run's child tree.
        let watcher_app = app.clone();
        let expected = run_id.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(u64::from(wallclock_limit) * 60));
            let managed = watcher_app.state::<LegacyTasks>();
            if let Ok(mut tasks) = managed.jobs.lock() {
                if let Some(task) = tasks.get_mut("zhidao") {
                    if task.run_id == expected &&
                       status_of("zhidao", task).map(|s| s.state == "running").unwrap_or(false) {
                        if let Some(process) = task.child.as_mut() {
                            #[cfg(windows)]
                            let finished = terminate_tree(process, task.process_job.as_ref()).is_ok();
                            #[cfg(not(windows))]
                            let finished = terminate_tree(process).is_ok();
                            if finished {
                                task.child = None;
                                #[cfg(windows)]
                                { task.process_job = None; }
                                task.exit_code = Some(12);
                                task.state = "exited".into();
                                remove_zhs_snapshot(task.monitor_token.as_deref());
                                remove_zhs_diagnostic(task.monitor_token.as_deref());
                                if let Some(token) = task.monitor_token.as_deref() { crate::zhs_queue::cleanup(token); }
                            }
                        }
                    }
                }
            };
        });
    }
    Ok(LegacyStatus {
        platform: platform.clone(), state: "running".into(), exit_code: None, run_id,
        course_id: if platform == "zhidao" { course_id } else { None },
        zhs_progress: None, zhs_last_resource: None, zhs_stale: false, diagnostic_code: None, zhs_queue: None,
    })
}

// Status polling may contend with Windows process termination; do not stall IPC.
#[tauri::command]
pub async fn legacy_status(app: AppHandle, platform: String) -> Result<LegacyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LegacyTasks>();
        legacy_status_blocking(state.inner(), platform)
    }).await.map_err(|_| "TASK_STATUS_FAILED".to_string())?
}

fn legacy_status_blocking(state: &LegacyTasks, platform: String) -> Result<LegacyStatus, String> {
    if platform != "zhidao" && platform != "yuketang" {
        return Err("UNKNOWN_PLATFORM".into());
    }
    let mut guard = state.jobs.lock().map_err(|_| "TASK_STATE_UNAVAILABLE")?;
    match guard.get_mut(&platform) {
        Some(task) => status_of(&platform, task),
        None => Ok(LegacyStatus {platform, state: "idle".into(), exit_code: None, run_id: None, course_id: None, zhs_progress: None, zhs_last_resource: None, zhs_stale: false, diagnostic_code: None, zhs_queue: None}),
    }
}

// Stop keeps the original run-id validation and process-tree termination, off IPC.
#[tauri::command]
pub async fn legacy_stop(app: AppHandle, platform: String, expected_run_id: Option<String>) -> Result<LegacyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LegacyTasks>();
        legacy_stop_blocking(state.inner(), platform, expected_run_id)
    }).await.map_err(|_| "TASK_STOP_FAILED".to_string())?
}

fn legacy_stop_blocking(state: &LegacyTasks, platform: String, expected_run_id: Option<String>) -> Result<LegacyStatus, String> {
    if platform != "zhidao" && platform != "yuketang" {
        return Err("UNKNOWN_PLATFORM".into());
    }
    let mut guard = state.jobs.lock().map_err(|_| "TASK_STATE_UNAVAILABLE")?;
    if let Some(job) = guard.get_mut(&platform) {
        crate::run_identity::verify_expected_run(expected_run_id.as_deref(), job.run_id.as_deref())
            .map_err(|code| code.to_owned())?;
        if status_of(&platform, job)?.state == "running" {
            let child = job.child.as_mut().ok_or("TASK_STATE_UNAVAILABLE")?;
            #[cfg(windows)]
            terminate_tree(child, job.process_job.as_ref())?;
            #[cfg(not(windows))]
            terminate_tree(child)?;
            job.child = None;
            #[cfg(windows)]
            { job.process_job = None; }
            job.state = "stopped".into();
            remove_zhs_snapshot(job.monitor_token.as_deref());
            remove_zhs_diagnostic(job.monitor_token.as_deref());
            if let Some(token) = job.monitor_token.as_deref() { crate::zhs_queue::cleanup(token); }
        }
        return status_of(&platform, job);
    }
    Err("TASK_RUN_CHANGED".into())
}

#[tauri::command]
pub async fn zhs_queue_stop_video(app: AppHandle, expected_run_id: String, task_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let managed = app.state::<LegacyTasks>();
        let mut guard = managed.jobs.lock().map_err(|_| "TASK_STATE_UNAVAILABLE")?;
        let job = guard.get_mut("zhidao").ok_or("TASK_RUN_CHANGED")?;
        crate::run_identity::verify_expected_run(Some(&expected_run_id), job.run_id.as_deref())
            .map_err(str::to_owned)?;
        let status = status_of("zhidao", job)?;
        if status.state != "running" { return Err("TASK_RUN_CHANGED".into()); }
        let queue = status.zhs_queue.ok_or("TASK_STATE_UNAVAILABLE")?;
        if queue.stale || !queue.tasks.iter().any(|row| row.task_id == task_id && matches!(row.state.as_str(), "queued" | "running")) {
            return Err("TASK_RUN_CHANGED".into());
        }
        let token = job.monitor_token.as_deref().ok_or("TASK_RUN_CHANGED")?;
        let path = crate::zhs_queue::path(token).ok_or("TASK_STATE_UNAVAILABLE")?;
        crate::zhs_queue::write_stop(path.parent().ok_or("TASK_STATE_UNAVAILABLE")?, token, &task_id)
    }).await.map_err(|_| "TASK_STOP_FAILED".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn course_keys_allow_only_exact_lowercase_hex() {
        assert!(valid_course_key(&"a".repeat(64)));
        assert!(!valid_course_key(&"A".repeat(64)));
        assert!(!valid_course_key("123"));
        assert!(!valid_course_key(&"g".repeat(64)));
    }
    #[test]
    fn progress_tokens_reject_path_traversal() {
        assert!(zhs_snapshot_path("../bad").is_none());
        assert!(zhs_snapshot_path(&"A".repeat(32)).is_none());
    }

    #[test]
    fn expired_zhs_snapshot_is_not_presented_as_live_progress() {
        let progress = ZhsProgress {
            video_segment_percent: Some(32.0), resource_index: Some(1), resource_total: Some(3),
            resource_kind: Some("video".into()), resource_name: Some("示例视频".into()),
        };
        let mut task = LegacyJob {
            child: None,
            #[cfg(windows)]
            process_job: None,
            state: "running".into(), exit_code: None, run_id: None,
            course_id: Some("a".repeat(64)), monitor_token: None,
            last_zhs_progress: Some(progress),
            last_diagnostic_code: None,
            last_zhs_queue: None,
        };
        let running = status_of("zhidao", &mut task).unwrap();
        assert!(running.zhs_progress.is_none());
        assert!(running.zhs_stale);
        let last = running.zhs_last_resource.expect("stale resource context");
        assert_eq!(last.resource_name.as_deref(), Some("示例视频"));
        assert_eq!(last.resource_kind.as_deref(), Some("video"));
        task.state = "exited".into();
        let exited = status_of("zhidao", &mut task).unwrap();
        assert_eq!(exited.zhs_progress.unwrap().video_segment_percent, Some(32.0));
        assert!(!exited.zhs_stale);
        task.state = "stopped".into();
        let stopped = status_of("zhidao", &mut task).unwrap();
        assert!(stopped.zhs_progress.is_none());
        assert!(!stopped.zhs_stale);
    }

    #[test]
    fn diagnostic_parser_never_exposes_untrusted_child_text_or_other_run_ids() {
        let nonce = "a".repeat(32);
        let now = 1_800_000_000.0;
        let accepted = serde_json::json!({
            "v": 1, "token": nonce, "code": "NETWORK_ERROR", "at": now
        }).to_string();
        assert_eq!(parse_zhs_diagnostic(accepted.as_bytes(), &nonce, now),
                   Some("NETWORK_ERROR".to_owned()));
        assert!(parse_zhs_diagnostic(accepted.as_bytes(), &"b".repeat(32), now).is_none());
        let leaked = serde_json::json!({
            "v": 1, "token": nonce, "code": "Cookie SECRET=123", "at": now
        }).to_string();
        assert!(parse_zhs_diagnostic(leaked.as_bytes(), &nonce, now).is_none());
        assert!(parse_zhs_diagnostic(accepted.as_bytes(), &nonce, now + 121.0).is_none());
        for stage in ["ZHS_SESSION_PREFLIGHT_FAILED", "ZHS_COURSE_URL_FAILED",
                      "ZHS_COOKIE_RESTORE_FAILED", "ZHS_SESSION_EXPIRED", "ZHS_SESSION_UNAVAILABLE"] {
            let payload = serde_json::json!({
                "v": 1, "token": nonce, "code": stage, "at": now
            }).to_string();
            assert_eq!(parse_zhs_diagnostic(payload.as_bytes(), &nonce, now),
                       Some(stage.to_owned()));
        }
    }

    #[test]
    fn zhs_command_workdir_uses_user_home_instead_of_inherited_cwd() {
        let home = PathBuf::from("test-profile-home");
        let mut command = Command::new("studyflow-bridge.exe");
        configure_zhidao_workdir(&mut command, &home);
        assert_eq!(command.get_current_dir(), Some(home.as_path()));
    }

    fn valid_yuketang_options() -> OriginalYktOptions {
        OriginalYktOptions {
            video_speed: 1.5,
            heartbeat_interval: 5,
            max_concurrent_videos: 3,
            completion_threshold: 90,
            skip_completed: true,
            use_concurrent: true,
            test_mode: false,
            test_video_count: 5,
            auto_richtext: false,
            debug: false,
            richtext_stay_seconds: 3,
            richtext_skip_delay: 1.0,
        }
    }

    #[test]
    fn zhs_threshold_is_optional_and_rejects_out_of_range_values() {
        let raw = serde_json::json!({
            "speed":1.5,"speed_cap":2.0,"limit_minutes":0,"learn_optional":false,
            "max_videos":0,"stop_on_error":false,"scope_mode":"all",
            "selected_ids":[],"resource_mode":"all"
        });
        let options: ZhsOptions = serde_json::from_value(raw.clone()).unwrap();
        assert!(options.completion_threshold.is_none());
        assert!(options.validate().is_ok());
        for valid in [1u8, 90, 100] {
            let mut with_threshold=raw.clone();
            with_threshold["completion_threshold"]=serde_json::json!(valid);
            let options: ZhsOptions=serde_json::from_value(with_threshold).unwrap();
            assert!(options.validate().is_ok());
        }
        for invalid in [0u8, 101] {
            let mut with_threshold=raw.clone();
            with_threshold["completion_threshold"]=serde_json::json!(invalid);
            let options: ZhsOptions=serde_json::from_value(with_threshold).unwrap();
            assert_eq!(options.validate().unwrap_err(), "INVALID_SETTINGS");
        }
    }

    #[test]
    fn yuketang_options_accept_supported_completion_threshold_boundaries() {
        let mut options = valid_yuketang_options();
        options.completion_threshold = 0;
        assert!(options.validate().is_ok());
        options.completion_threshold = 100;
        assert!(options.validate().is_ok());
    }

    #[test]
    fn yuketang_options_reject_completion_threshold_above_100() {
        let mut options = valid_yuketang_options();
        options.completion_threshold = 101;
        assert_eq!(options.validate().unwrap_err(), "INVALID_SETTINGS");
    }

    #[test]
    fn yuketang_richtext_options_accept_supported_boundaries() {
        let mut options = valid_yuketang_options();
        options.richtext_stay_seconds = 0;
        options.richtext_skip_delay = 0.0;
        assert!(options.validate().is_ok());
        options.richtext_stay_seconds = 3600;
        options.richtext_skip_delay = 3600.0;
        assert!(options.validate().is_ok());
    }

    #[test]
    fn yuketang_richtext_options_reject_invalid_delays() {
        let mut options = valid_yuketang_options();
        options.richtext_stay_seconds = 3601;
        assert_eq!(options.validate().unwrap_err(), "INVALID_SETTINGS");
        options = valid_yuketang_options();
        options.richtext_skip_delay = f64::NAN;
        assert_eq!(options.validate().unwrap_err(), "INVALID_SETTINGS");
        options.richtext_skip_delay = -0.1;
        assert_eq!(options.validate().unwrap_err(), "INVALID_SETTINGS");
    }

    #[cfg(windows)]
    #[test]
    fn stopping_owned_windows_job_releases_worker_for_restart() {
        use std::os::windows::process::CommandExt;
        // Two successive worker launches must each be fully reaped. No global
        // process-name kill and no dependency on the user's account.
        for _ in 0..2 {
            let mut child = Command::new("cmd.exe")
                .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
                .creation_flags(0x08000000)
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                .spawn().expect("spawn test-owned child");
            let job = WindowsJob::attach(&child).expect("attach test-owned Windows Job Object");
            terminate_tree(&mut child, Some(&job)).expect("stop entire job");
            assert!(child.try_wait().unwrap().is_some());
        }
    }

    #[test]
    fn yuketang_options_pass_through_all_original_environment_fields() {
        let options = valid_yuketang_options();
        let mut command = Command::new("unused-studyflow-test-command");
        options.apply(&mut command);
        let env: HashMap<String, String> = command.get_envs()
            .filter_map(|(key, value)| value.map(|value| (
                key.to_string_lossy().into_owned(),
                value.to_string_lossy().into_owned(),
            )))
            .collect();
        assert_eq!(env.get("DEBUG").map(String::as_str), Some("false"));
        assert_eq!(env.get("RICHTEXT_STAY_SECONDS").map(String::as_str), Some("3"));
        assert_eq!(env.get("RICHTEXT_SKIP_DELAY").map(String::as_str), Some("1"));
    }
}
