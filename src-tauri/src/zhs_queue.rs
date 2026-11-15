//! Bounded, run-scoped local queue telemetry. No server-completion inference.
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
pub struct QueueTask {
    pub task_id: String,
    pub name: Option<String>,
    pub kind: String,
    pub state: String,
    pub percent: Option<f64>,
    pub stale: bool,
    pub exit_code: Option<i64>,
}

#[derive(Clone, Serialize)]
pub struct QueueSnapshot {
    pub concurrency: u64,
    pub state: String,
    pub stale: bool,
    pub tasks: Vec<QueueTask>,
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

pub fn path(token: &str) -> Option<PathBuf> {
    if !valid_id(token) { return None; }
    Some(PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("StudyFlow")
        .join(format!("zhs-queue-{token}.json")))
}

pub fn parse(bytes: &[u8], token: &str, now: f64) -> Option<QueueSnapshot> {
    if bytes.len() > 4_000_000 || !valid_id(token) { return None; }
    let data: Value = serde_json::from_slice(bytes).ok()?;
    if data.get("v")?.as_u64()? != 1 || data.get("token")?.as_str()? != token { return None; }
    let at = data.get("at")?.as_f64()?;
    if !at.is_finite() || at > now + 10.0 { return None; }
    let stale = now - at > 18.0;
    let concurrency = data.get("concurrency")?.as_u64()?;
    if !(1..=3).contains(&concurrency) { return None; }
    let state = data.get("state")?.as_str()?;
    if !matches!(state, "running" | "exited") { return None; }
    let raw_tasks = data.get("tasks")?.as_array()?;
    if raw_tasks.len() > 10000 { return None; }
    let mut seen = HashSet::new();
    let mut tasks = Vec::new();
    for row in raw_tasks {
        let id = row.get("task_id")?.as_str()?;
        if !valid_id(id) || !seen.insert(id.to_owned()) { return None; }
        let kind = row.get("kind")?.as_str()?;
        if !matches!(kind, "video" | "ppt" | "article" | "other") { return None; }
        let row_state = row.get("state")?.as_str()?;
        if !matches!(row_state, "queued" | "running" | "exited" | "failed" | "stopped") { return None; }
        let name = match row.get("name")? {
            Value::Null => None,
            value => {
                let text = value.as_str()?;
                if text.is_empty() || text.chars().count() > 90 || text.chars().any(char::is_control)
                    || text.contains('@') || text.contains('=')
                    || ["http:", "https:", "cookie", "token", "authorization", "password", "secret", "apikey", "api_key"]
                        .iter().any(|marker| text.to_lowercase().contains(marker)) { return None; }
                Some(text.to_owned())
            }
        };
        let row_stale = stale || row.get("stale")?.as_bool()?;
        let raw_percent = row.get("percent")?;
        let percent = if raw_percent.is_null() { None } else {
            let percent = raw_percent.as_f64()?;
            if !percent.is_finite() || !(0.0..=100.0).contains(&percent) { return None; }
            if row_stale || row_state == "stopped" { None } else { Some(percent) }
        };
        let exit_code = if row.get("exit_code")?.is_null() { None } else {
            Some(row.get("exit_code")?.as_i64()?)
        };
        tasks.push(QueueTask {task_id: id.into(), name, kind: kind.into(), state: row_state.into(),
            percent, stale: row_stale, exit_code});
    }
    Some(QueueSnapshot {concurrency, state: state.into(), stale, tasks})
}

pub fn read(token: &str, now: f64) -> Option<QueueSnapshot> {
    let path = path(token)?;
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > 4_000_000 { return None; }
    parse(&std::fs::read(path).ok()?, token, now)
}

pub fn write_stop(root: &Path, token: &str, id: &str) -> Result<(), String> {
    if !valid_id(token) || !valid_id(id) { return Err("INVALID_REQUEST".into()); }
    let temporary = root.join(format!(".zhs-stop-{}", uuid::Uuid::new_v4().simple()));
    std::fs::write(&temporary, id).map_err(|_| "TASK_STOP_FAILED")?;
    let result = std::fs::rename(&temporary, root.join(format!("zhs-stop-{token}-{id}")))
        .map_err(|_| "TASK_STOP_FAILED".to_owned());
    let _ = std::fs::remove_file(temporary);
    result
}

pub fn cleanup(token: &str) {
    if let Some(path) = path(token) {
        let _ = std::fs::remove_file(&path);
        if let Some(root) = path.parent() {
            if let Ok(entries) = std::fs::read_dir(root) {
                let prefix = format!("zhs-stop-{token}-");
                for entry in entries.flatten() {
                    if entry.file_name().to_string_lossy().starts_with(&prefix) {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn sample() -> Value {
        json!({"v":1,"token":"a".repeat(32),"at":100.0,"concurrency":2,"state":"running",
            "tasks":[{"task_id":"b".repeat(32),"name":"电路分析","kind":"video","state":"running",
                "percent":48.5,"stale":false,"exit_code":null}]})
    }
    #[test]
    fn only_matching_run_can_supply_fresh_progress() {
        let data = sample().to_string();
        assert_eq!(parse(data.as_bytes(), &"a".repeat(32), 101.0).unwrap().tasks[0].percent, Some(48.5));
        assert!(parse(data.as_bytes(), &"c".repeat(32), 101.0).is_none());
        let old = parse(data.as_bytes(), &"a".repeat(32), 120.0).unwrap();
        assert!(old.stale);
        assert!(old.tasks[0].percent.is_none());
    }
    #[test]
    fn malformed_duplicate_and_private_rows_are_rejected() {
        for (field, value) in [("percent",json!(101)),("name",json!("cookie=secret")),
            ("state",json!("completed")),("task_id",json!("../bad"))] {
            let mut data = sample();
            data["tasks"][0][field] = value;
            assert!(parse(data.to_string().as_bytes(), &"a".repeat(32),101.0).is_none());
        }
        let mut data = sample();
        let duplicate = data["tasks"][0].clone();
        data["tasks"].as_array_mut().unwrap().push(duplicate);
        assert!(parse(data.to_string().as_bytes(), &"a".repeat(32),101.0).is_none());
    }
}
