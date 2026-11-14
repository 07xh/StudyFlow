//! Process-only integration of the original ZHS and Rain Classroom executors.
//! Their heartbeat generators, senders, defaults and upstream source are unchanged.
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct LegacyTasks {
    jobs: Mutex<HashMap<String, LegacyJob>>,
}

struct LegacyJob {
    child: Option<Child>,
    state: String,
    exit_code: Option<i32>,
}

#[derive(Serialize)]
pub struct LegacyStatus {
    platform: String,
    state: String,
    exit_code: Option<i32>,
}

fn status_of(platform: &str, task: &mut LegacyJob) -> Result<LegacyStatus, String> {
    if let Some(child) = &mut task.child {
        if let Some(code) = child.try_wait().map_err(|_| "TASK_STATUS_FAILED")? {
            task.exit_code = code.code();
            task.state = "exited".into();
            task.child = None;
        }
    }
    Ok(LegacyStatus {
        platform: platform.into(),
        state: task.state.clone(),
        exit_code: task.exit_code,
    })
}

fn terminate_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        // The original .cmd script can create a child ZHS Python process.
        // Stop the entire task tree, never an unrelated process.
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

impl LegacyTasks {
    pub(crate) fn shutdown(&self) {
        if let Ok(mut guard) = self.jobs.lock() {
            for (_, task) in guard.iter_mut() {
                if let Some(mut child) = task.child.take() {
                    terminate_tree(&mut child);
                    task.state = "stopped".into();
                }
            }
        }
    }
}

fn valid_course_key(key: &str) -> bool {
    key.len() == 64 && key.as_bytes().iter().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

#[tauri::command]
pub fn legacy_start(
    app: AppHandle, state: State<'_, LegacyTasks>,
    platform: String, course_id: Option<String>
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
    let mut guard = state.jobs.lock().map_err(|_| "TASK_STATE_UNAVAILABLE")?;
    if let Some(previous) = guard.get_mut(&platform) {
        if status_of(&platform, previous)?.state == "running" {
            return Err("TASK_ALREADY_RUNNING".into());
        }
    }
    let binary = crate::bridge_binary(&app).map_err(|_| "LEGACY_NOT_INSTALLED")?;
    let mut command = Command::new(binary);
    if platform == "zhidao" {
        command.arg("--legacy-zhidao").arg(course_id.as_deref().unwrap_or(""));
    } else {
        command.arg("--legacy-yuketang");
    }
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let child = command.spawn().map_err(|_| "LEGACY_LAUNCH_FAILED")?;
    guard.insert(platform.clone(), LegacyJob {
        child: Some(child), state: "running".into(), exit_code: None
    });
    Ok(LegacyStatus {
        platform, state: "running".into(), exit_code: None
    })
}

#[tauri::command]
pub fn legacy_status(state: State<'_, LegacyTasks>, platform: String) -> Result<LegacyStatus, String> {
    if platform != "zhidao" && platform != "yuketang" {
        return Err("UNKNOWN_PLATFORM".into());
    }
    let mut guard = state.jobs.lock().map_err(|_| "TASK_STATE_UNAVAILABLE")?;
    match guard.get_mut(&platform) {
        Some(task) => status_of(&platform, task),
        None => Ok(LegacyStatus {platform, state: "idle".into(), exit_code: None}),
    }
}

#[tauri::command]
pub fn legacy_stop(state: State<'_, LegacyTasks>, platform: String) -> Result<LegacyStatus, String> {
    if platform != "zhidao" && platform != "yuketang" {
        return Err("UNKNOWN_PLATFORM".into());
    }
    let mut guard = state.jobs.lock().map_err(|_| "TASK_STATE_UNAVAILABLE")?;
    if let Some(job) = guard.get_mut(&platform) {
        if status_of(&platform, job)?.state == "running" {
            if let Some(mut child) = job.child.take() {
                terminate_tree(&mut child);
                job.state = "stopped".into();
            }
        }
        return status_of(&platform, job);
    }
    Ok(LegacyStatus {platform, state: "idle".into(), exit_code: None})
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
}
