//! Bounded, run-scoped local queue telemetry. No server-completion inference.
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
pub struct QueueTask {
    pub task_id: String,
    pub name: Option<String>,
    pub chapter_key: Option<String>,
    pub chapter_name: Option<String>,
    pub kind: String,
    pub requirement: Option<String>,
    pub state: String,
    pub percent: Option<f64>,
    pub playback_phase: Option<String>,
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
        if !matches!(kind, "video" | "ppt" | "article" | "other" | "detail") { return None; }
        let row_state = row.get("state")?.as_str()?;
        if !matches!(row_state, "queued" | "running" | "exited" | "failed" | "stopped" | "unconfirmed" | "informational") { return None; }
        // A detail-only knowledge point is visible for diagnosis, but can
        // never be represented as a completed/active ZHS resource.
        if (kind == "detail") != (row_state == "informational") { return None; }
        let requirement = match row.get("requirement") {
            None | Some(Value::Null) => None,
            Some(value) => {
                let kind = value.as_str()?;
                if !matches!(kind, "required" | "optional" | "unknown" | "shared") { return None; }
                Some(kind.to_owned())
            }
        };
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
        // Older rc.23 snapshots have no chapter fields. Accept those for a
        // seamless upgrade but reject malformed or unsafe new metadata.
        let chapter_key = match row.get("chapter_key") {
            None | Some(Value::Null) => None,
            Some(raw) => {
                let text = raw.as_str()?;
                if text.is_empty() || text.len() > 48 ||
                    !text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                    return None;
                }
                Some(text.to_owned())
            }
        };
        let chapter_name = match row.get("chapter_name") {
            None | Some(Value::Null) => None,
            Some(raw) => {
                let text = raw.as_str()?;
                if text.is_empty() || text.chars().count() > 90 ||
                    text.chars().any(char::is_control) || text.contains('@') || text.contains('=') ||
                    ["http:", "https:", "cookie", "token", "authorization", "password", "secret", "apikey", "api_key"]
                        .iter().any(|marker| text.to_lowercase().contains(marker)) { return None; }
                Some(text.to_owned())
            }
        };
        let row_stale = stale || row.get("stale")?.as_bool()?;
        // The queue may carry a fresh read-only console phase even when the
        // official upstream output has no valid playing percentage.
        let playback_phase = match row.get("playback_phase") {
            None | Some(Value::Null) => None,
            Some(raw) => {
                let phase = raw.as_str()?;
                if !matches!(phase, "playing" | "paused" | "answering") { return None; }
                if row_stale || row_state != "running" { None } else { Some(phase.to_owned()) }
            }
        };
        let raw_percent = row.get("percent")?;
        let percent = if raw_percent.is_null() { None } else {
            let percent = raw_percent.as_f64()?;
            if !percent.is_finite() || !(0.0..=100.0).contains(&percent) || matches!(playback_phase.as_deref(), Some("paused" | "answering")) { return None; }
            if row_stale || row_state != "running" { None } else { Some(percent) }
        };
        let exit_code = if row.get("exit_code")?.is_null() { None } else {
            Some(row.get("exit_code")?.as_i64()?)
        };
        if row_state == "informational" && (percent.is_some() || playback_phase.is_some() || exit_code.is_some()) {
            return None;
        }
        tasks.push(QueueTask {task_id: id.into(), name, chapter_key, chapter_name,
            kind: kind.into(), requirement, state: row_state.into(),
            percent, playback_phase, stale: row_stale, exit_code});
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
    fn chapter_metadata_is_optional_for_old_snapshots_but_validated_when_present() {
        let mut data = sample();
        assert!(parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).is_some());
        data["tasks"][0]["chapter_key"] = json!("ai-2");
        data["tasks"][0]["chapter_name"] = json!("第二章");
        let snapshot = parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).unwrap();
        assert_eq!(snapshot.tasks[0].chapter_key.as_deref(), Some("ai-2"));
        assert_eq!(snapshot.tasks[0].chapter_name.as_deref(), Some("第二章"));
        data["tasks"][0]["chapter_name"] = json!("cookie=secret");
        assert!(parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).is_none());
        data["tasks"][0]["chapter_name"] = json!("第二章");
        data["tasks"][0]["chapter_key"] = json!("../bad");
        assert!(parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).is_none());
    }
    #[test]
    fn scoped_console_phases_are_validated_without_inventing_progress() {
        for phase in ["paused", "answering", "playing"] {
            let mut data = sample();
            data["tasks"][0]["playback_phase"] = json!(phase);
            if phase != "playing" { data["tasks"][0]["percent"] = Value::Null; }
            let parsed = parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).unwrap();
            assert_eq!(parsed.tasks[0].playback_phase.as_deref(), Some(phase));
            if phase != "playing" { assert!(parsed.tasks[0].percent.is_none()); }
            let stale = parse(data.to_string().as_bytes(), &"a".repeat(32), 120.0).unwrap();
            assert!(stale.tasks[0].playback_phase.is_none());
        }
        let mut data = sample();
        data["tasks"][0]["playback_phase"] = json!("answering");
        assert!(parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).is_none(),
            "answering may not masquerade as a playing percentage");
        data["tasks"][0]["percent"] = Value::Null;
        data["tasks"][0]["playback_phase"] = json!("unauthorized");
        assert!(parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).is_none());
    }
    #[test]
    fn requirement_and_unconfirmed_server_state_are_bounded() {
        let mut data = sample();
        data["tasks"][0]["requirement"] = json!("required");
        data["tasks"][0]["state"] = json!("unconfirmed");
        data["tasks"][0]["exit_code"] = json!(16);
        let parsed = parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).unwrap();
        assert_eq!(parsed.tasks[0].requirement.as_deref(), Some("required"));
        assert_eq!(parsed.tasks[0].state, "unconfirmed");
        data["tasks"][0]["requirement"] = json!("unexpected");
        assert!(parse(data.to_string().as_bytes(), &"a".repeat(32), 101.0).is_none());
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
