//! Optional StudyFlow distribution license. Does not gate GPL course workflows.
//! Ed25519 signed leases are checked in Rust (never in the React UI).
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, time::{Duration, SystemTime, UNIX_EPOCH}};

const MAX_LEASE: usize = 2048;
const MAX_CACHE: u64 = 16384;
const CLOCK_SKEW: i64 = 300;

#[derive(Debug, Deserialize)]
struct Claims {
    v: u8,
    kid: String,
    license_id: String,
    binding_id: String,
    device_hash: String,
    issued_at: i64,
    expires_at: i64,
    offline_until: i64,
    features: Vec<String>,
}
#[derive(Default, Serialize, Deserialize)]
struct Cache {
    device_id: String,
    lease: Option<String>,
    last_seen: i64,
}
#[derive(Deserialize)]
struct ServerReply {
    lease: String,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}
fn path() -> Result<PathBuf,String> {
    let root = std::env::var_os("LOCALAPPDATA").ok_or("LICENSE_STORAGE_UNAVAILABLE")?;
    Ok(PathBuf::from(root).join("StudyFlow").join("license").join("v1.dat"))
}
#[cfg(windows)]
mod protected {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct Blob { len: u32, ptr: *mut u8 }
    #[link(name="Crypt32")]
    extern "system" {
        fn CryptProtectData(input: *const Blob, desc: *const u16, entropy: *const Blob, reserved: *const c_void,
            prompt: *const c_void, flags: u32, output: *mut Blob) -> i32;
        fn CryptUnprotectData(input: *const Blob, desc: *mut *mut u16, entropy: *const Blob,
            reserved: *const c_void, prompt: *const c_void, flags: u32, output: *mut Blob) -> i32;
    }
    #[link(name="Kernel32")]
    extern "system" { fn LocalFree(p: *mut c_void) -> *mut c_void; }

    fn transform(data: &[u8], encrypt: bool) -> Result<Vec<u8>,String> {
        let in_blob = Blob { len: data.len() as u32, ptr: data.as_ptr() as *mut u8 };
        let mut out_blob = Blob { len: 0, ptr: ptr::null_mut() };
        // Windows current-user DPAPI, no hardcoded password or application secret.
        let ok = unsafe {
            if encrypt {
                CryptProtectData(&in_blob, ptr::null(), ptr::null(), ptr::null(), ptr::null(), 1, &mut out_blob)
            } else {
                CryptUnprotectData(&in_blob, ptr::null_mut(), ptr::null(), ptr::null(), ptr::null(), 1, &mut out_blob)
            }
        };
        if ok == 0 { return Err("LICENSE_DPAPI_FAILED".into()); }
        let output = unsafe { std::slice::from_raw_parts(out_blob.ptr, out_blob.len as usize).to_vec() };
        unsafe { LocalFree(out_blob.ptr.cast()); }
        Ok(output)
    }
    pub fn protect(data: &[u8]) -> Result<Vec<u8>,String> { transform(data, true) }
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>,String> { transform(data, false) }
}
#[cfg(not(windows))]
mod protected {
    pub fn protect(_: &[u8]) -> Result<Vec<u8>,String> { Err("WINDOWS_ONLY".into()) }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>,String> { Err("WINDOWS_ONLY".into()) }
}
fn save(cache: &Cache) -> Result<(),String> {
    let p = path()?;
    let parent = p.parent().ok_or("LICENSE_STORAGE_UNAVAILABLE")?;
    fs::create_dir_all(parent).map_err(|_| "LICENSE_STORAGE_UNAVAILABLE")?;
    let encoded = serde_json::to_vec(cache).map_err(|_| "LICENSE_STORAGE_UNAVAILABLE")?;
    let protected = protected::protect(&encoded)?;
    let tmp = parent.join(format!("v1-{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&tmp, protected).map_err(|_| "LICENSE_STORAGE_UNAVAILABLE")?;
    if p.exists() {
        fs::remove_file(&p).map_err(|_| "LICENSE_STORAGE_UNAVAILABLE")?;
    }
    fs::rename(&tmp, p).map_err(|_| "LICENSE_STORAGE_UNAVAILABLE")?;
    Ok(())
}
fn load() -> Result<Cache,String> {
    let p = path()?;
    match fs::symlink_metadata(&p) {
        Ok(metadata) => {
            if !metadata.file_type().is_file() || metadata.len() > MAX_CACHE { return Err("LICENSE_CACHE_INVALID".into()); }
            let protected = fs::read(&p).map_err(|_| "LICENSE_STORAGE_UNAVAILABLE")?;
            let cache: Cache = serde_json::from_slice(&protected::unprotect(&protected)?)
                .map_err(|_| "LICENSE_CACHE_INVALID")?;
            uuid::Uuid::parse_str(&cache.device_id).map_err(|_| "LICENSE_CACHE_INVALID")?;
            Ok(cache)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let new = Cache { device_id: uuid::Uuid::new_v4().to_string(), lease: None, last_seen: 0 };
            save(&new)?;
            Ok(new)
        }
        Err(_) => Err("LICENSE_STORAGE_UNAVAILABLE".into()),
    }
}
fn public_key() -> Option<&'static str> { option_env!("STUDYFLOW_LICENSE_PUBKEY_B64") }
fn worker_url() -> Result<String,String> {
    const URL: Option<&str> = option_env!("STUDYFLOW_LICENSE_URL");
    let url = URL.ok_or("LICENSE_NOT_CONFIGURED")?;
    let parsed = reqwest::Url::parse(url).map_err(|_| "LICENSE_NOT_CONFIGURED")?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() ||
        !parsed.username().is_empty() || parsed.password().is_some() ||
        parsed.query().is_some() || parsed.fragment().is_some() ||
        parsed.path() != "/" {
        return Err("LICENSE_NOT_CONFIGURED".into());
    }
    Ok(url.trim_end_matches('/').to_owned())
}
fn verify_signature(lease: &str, key_b64: &str) -> Result<Claims,String> {
    if lease.len() > MAX_LEASE { return Err("LICENSE_INVALID".into()); }
    let (body, signature) = lease.split_once('.').ok_or("LICENSE_INVALID")?;
    if signature.contains('.') { return Err("LICENSE_INVALID".into()); }
    let raw = URL_SAFE_NO_PAD.decode(body).map_err(|_| "LICENSE_INVALID")?;
    let sig = URL_SAFE_NO_PAD.decode(signature).map_err(|_| "LICENSE_INVALID")?;
    if raw.len() > 1200 { return Err("LICENSE_INVALID".into()); }
    let pubkey = STANDARD.decode(key_b64).map_err(|_| "LICENSE_NOT_CONFIGURED")?;
    let key_bytes: [u8;32] = pubkey.try_into().map_err(|_| "LICENSE_NOT_CONFIGURED")?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| "LICENSE_NOT_CONFIGURED")?;
    let signature = Signature::from_slice(&sig).map_err(|_| "LICENSE_INVALID")?;
    key.verify(&raw, &signature).map_err(|_| "LICENSE_INVALID")?;
    serde_json::from_slice(&raw).map_err(|_| "LICENSE_INVALID".into())
}
fn verify_lease(lease: &str, device: &str, current: i64, pubkey: &str) -> Result<Claims,String> {
    let claims = verify_signature(lease, pubkey)?;
    let device_hash = format!("{:x}", Sha256::digest(format!("device-v1:{device}").as_bytes()));
    if claims.v != 1 || claims.kid != "v1" ||
        claims.license_id.is_empty() || claims.binding_id.is_empty() ||
        claims.device_hash != device_hash ||
        claims.issued_at > current + CLOCK_SKEW ||
        claims.issued_at >= claims.offline_until ||
        claims.offline_until > claims.expires_at ||
        claims.offline_until < current || claims.expires_at < current ||
        !claims.features.iter().any(|f| f == "community_distribution") {
        return Err("LICENSE_INVALID_OR_EXPIRED".into());
    }
    Ok(claims)
}
fn status_value(cache: &Cache) -> Value {
    let current = now();
    let Some(key) = public_key() else { return json!({"state":"not_configured"}); };
    if cache.last_seen > current + CLOCK_SKEW { return json!({"state":"clock_error"}); }
    let Some(ref lease) = cache.lease else { return json!({"state":"not_activated"}); };
    match verify_lease(lease, &cache.device_id, current, key) {
        Ok(claims) => json!({"state":"active_offline","license_id":claims.license_id,
            "expires_at":claims.expires_at,"offline_until":claims.offline_until}),
        Err(_) => json!({"state":"expired_or_invalid"}),
    }
}
fn update_last_seen(cache: &mut Cache) -> Result<(),String> {
    let current = now();
    if cache.last_seen > current + CLOCK_SKEW { return Err("LICENSE_CLOCK_ERROR".into()); }
    cache.last_seen = cache.last_seen.max(current);
    save(cache)
}
fn http(path: &str, body: Value) -> Result<Value,String> {
    let url = worker_url()? + path;
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(12))
        .build().map_err(|_| "LICENSE_NETWORK_ERROR")?;
    let response = client.post(url).json(&body).send().map_err(|_| "LICENSE_NETWORK_ERROR")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            409 => "LICENSE_DEVICE_LIMIT",
            429 => "LICENSE_RATE_LIMITED",
            400 => "LICENSE_REJECTED",
            _ => "LICENSE_SERVICE_ERROR"
        }.into());
    }
    response.json::<Value>().map_err(|_| "LICENSE_SERVER_INVALID".into())
}
#[tauri::command]
pub fn license_status() -> Result<Value,String> {
    let mut cache = load()?;
    let result = status_value(&cache);
    if result["state"] == "active_offline" { update_last_seen(&mut cache)?; }
    Ok(result)
}
fn activate(code: &str) -> Result<Value,String> {
    let mut cache = load()?;
    if code.len() > 64 || !code.starts_with("SF-") { return Err("LICENSE_CODE_INVALID".into()); }
    let result = http("/v1/activate", json!({"code":code,"device_id":cache.device_id}))?;
    let reply: ServerReply = serde_json::from_value(result).map_err(|_| "LICENSE_SERVER_INVALID")?;
    let key = public_key().ok_or("LICENSE_NOT_CONFIGURED")?;
    verify_lease(&reply.lease, &cache.device_id, now(), key)?;
    cache.lease = Some(reply.lease);
    update_last_seen(&mut cache)?;
    Ok(status_value(&cache))
}
#[tauri::command]
pub async fn license_activate(code: String) -> Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move || activate(code.trim()))
        .await.map_err(|_| "LICENSE_WORKER_FAILED".to_string())?
}
fn refresh() -> Result<Value,String> {
    let mut cache = load()?;
    let lease = cache.lease.as_ref().ok_or("LICENSE_NOT_ACTIVATED")?.clone();
    let key = public_key().ok_or("LICENSE_NOT_CONFIGURED")?;
    verify_lease(&lease, &cache.device_id, now(), key)?;
    let result = http("/v1/refresh", json!({"lease":lease,"device_id":cache.device_id}))?;
    let reply: ServerReply = serde_json::from_value(result).map_err(|_| "LICENSE_SERVER_INVALID")?;
    verify_lease(&reply.lease, &cache.device_id, now(), key)?;
    cache.lease = Some(reply.lease);
    update_last_seen(&mut cache)?;
    Ok(status_value(&cache))
}
#[tauri::command]
pub async fn license_refresh() -> Result<Value,String> {
    tauri::async_runtime::spawn_blocking(refresh).await.map_err(|_| "LICENSE_WORKER_FAILED".to_string())?
}
fn release() -> Result<Value,String> {
    let mut cache = load()?;
    let lease = cache.lease.as_ref().ok_or("LICENSE_NOT_ACTIVATED")?.clone();
    let answer = http("/v1/release", json!({"lease":lease,"device_id":cache.device_id}))?;
    if answer["released"] != true { return Err("LICENSE_SERVER_INVALID".into()); }
    cache.lease = None;
    update_last_seen(&mut cache)?;
    Ok(status_value(&cache))
}
#[tauri::command]
pub async fn license_release() -> Result<Value,String> {
    tauri::async_runtime::spawn_blocking(release).await.map_err(|_| "LICENSE_WORKER_FAILED".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    const TEST_PUBLIC: &str = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
    const TEST_DEVICE: &str = "33333333-3333-4333-8333-333333333333";
    const TEST_LEASE: &str = "eyJ2IjoxLCJraWQiOiJ2MSIsImxpY2Vuc2VfaWQiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJiaW5kaW5nX2lkIjoiMjIyMjIyMjItMjIyMi0yMjIyLTIyMjItMjIyMjIyMjIyMjIyIiwiZGV2aWNlX2hhc2giOiI4MzMwZGM2ZTM2YWMyYWRmYTU1NjBlZDY5MWNkZmUyNmFmNjY4ZTZjZDQzMDRiOWE2OGRjMjU0ZmMwYzUzODg3IiwiaXNzdWVkX2F0IjoxNzAwMDAwMDAwLCJleHBpcmVzX2F0IjoyMTQ3NDgzNjQ3LCJvZmZsaW5lX3VudGlsIjoxNzAwNjAwMDAwLCJmZWF0dXJlcyI6WyJjb21tdW5pdHlfZGlzdHJpYnV0aW9uIl19.JY_EF-XftiCrJGTEg5X8Suw_UdN_-bseXD6xw_CHd6lgsI6gBOJVHl39-w5TOWiJow9yX5ticqFRFAF_PKD1Ag";
    #[test]
    fn verifies_offline_signature_and_device() {
        assert!(verify_lease(TEST_LEASE, TEST_DEVICE, 1_700_001_000, TEST_PUBLIC).is_ok());
        assert!(verify_lease(TEST_LEASE, "99999999-9999-4999-8999-999999999999", 1_700_001_000, TEST_PUBLIC).is_err());
        assert!(verify_lease(TEST_LEASE, TEST_DEVICE, 1_700_700_000, TEST_PUBLIC).is_err());
    }
    #[test]
    fn rejects_tampered_signature() {
        let mut broken = TEST_LEASE.to_string();
        broken.push('A');
        assert!(verify_lease(&broken, TEST_DEVICE, 1_700_001_000, TEST_PUBLIC).is_err());
    }
}
