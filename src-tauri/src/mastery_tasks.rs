//! Isolated background worker for MIT-licensed mastery helper.
//! Does not modify the original ZHS video scheduler or its heartbeat logic.
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct MasteryTasks {
    child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
pub struct MasteryStatus {
    pub running: bool,
    pub state: String,
    pub detail: Value,
}

fn root() -> Result<PathBuf, String> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("MASTERY_STORAGE_UNAVAILABLE")?;
    Ok(PathBuf::from(local).join("StudyFlow").join("ZhidaoMastery"))
}

fn data_status() -> Value {
    let path = match root() { Ok(path) => path.join("status.json"), Err(_) => return json!({}) };
    match fs::read(&path) {
        Ok(data) if data.len() <= 32 * 1024 =>
            serde_json::from_slice(&data).unwrap_or_else(|_| json!({})),
        _ => json!({}),
    }
}

fn snapshot(child: &mut Option<Child>) -> Result<MasteryStatus, String> {
    let active = match child.as_mut() {
        Some(process) => match process.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => { *child = None; false },
            Err(_) => { *child = None; false },
        },
        None => false,
    };
    let detail = data_status();
    let state = if active {
        detail.get("phase").and_then(Value::as_str).unwrap_or("运行中").to_string()
    } else {
        detail.get("state").and_then(Value::as_str).unwrap_or("idle").to_string()
    };
    Ok(MasteryStatus {running: active, state, detail})
}

#[tauri::command]
pub fn zhidao_mastery_status(app: AppHandle) -> Result<MasteryStatus, String> {
    let state = app.state::<MasteryTasks>();
    let mut guard = state.child.lock().map_err(|_| "MASTERY_TASK_UNAVAILABLE")?;
    snapshot(&mut guard)
}

#[tauri::command]
pub fn zhidao_mastery_start(app: AppHandle) -> Result<MasteryStatus, String> {
    let state = app.state::<MasteryTasks>();
    let mut guard = state.child.lock().map_err(|_| "MASTERY_TASK_UNAVAILABLE")?;
    if snapshot(&mut guard)?.running {
        return Err("MASTERY_ALREADY_RUNNING".into());
    }
    let bin = crate::bridge_binary(&app)?;
    let dir = root()?;
    fs::create_dir_all(&dir).map_err(|_| "MASTERY_STORAGE_UNAVAILABLE")?;
    let _ = fs::remove_file(dir.join("stop.flag"));
    let _ = fs::remove_file(dir.join("pause.flag"));
    let _ = fs::remove_file(dir.join("status.json"));
    let mut command = Command::new(bin);
    command.arg("--zhidao-mastery-worker")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // No terminal or Tk window
    }
    *guard = Some(command.spawn().map_err(|_| "MASTERY_START_FAILED")?);
    snapshot(&mut guard)
}

#[tauri::command]
pub fn zhidao_mastery_pause(app: AppHandle, paused: bool) -> Result<MasteryStatus, String> {
    let state = app.state::<MasteryTasks>();
    let mut guard = state.child.lock().map_err(|_| "MASTERY_TASK_UNAVAILABLE")?;
    if !snapshot(&mut guard)?.running { return Err("MASTERY_NOT_RUNNING".into()); }
    let path = root()?.join("pause.flag");
    if paused {
        fs::write(&path, b"1").map_err(|_| "MASTERY_STORAGE_UNAVAILABLE")?;
    } else {
        let _ = fs::remove_file(&path);
    }
    snapshot(&mut guard)
}

fn stop_process(process: &mut Child) {
    #[cfg(windows)]
    {
        // Only terminate this StudyFlow-created worker and its browser descendants.
        let _ = Command::new("taskkill")
            .args(["/PID", &process.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = process.kill();
    let _ = process.wait();
}

#[tauri::command]
pub fn zhidao_mastery_stop(app: AppHandle) -> Result<MasteryStatus, String> {
    let state = app.state::<MasteryTasks>();
    let mut guard = state.child.lock().map_err(|_| "MASTERY_TASK_UNAVAILABLE")?;
    let dir = root()?;
    let _ = fs::remove_file(dir.join("pause.flag"));
    let _ = fs::write(dir.join("stop.flag"), b"1");
    if let Some(mut child) = guard.take() {
        stop_process(&mut child);
    }
    let mut status = snapshot(&mut guard)?;
    status.state = "stopped".into();
    if let Some(detail) = status.detail.as_object_mut() {
        detail.insert("state".into(), json!("stopped"));
        detail.insert("phase".into(), json!("已停止"));
    }
    Ok(status)
}

impl MasteryTasks {
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut process) = guard.take() {
                stop_process(&mut process);
            }
        }
    }
}
