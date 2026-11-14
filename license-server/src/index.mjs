// StudyFlow License V1: optional distribution-management authorization.
// No GPL platform operation is gated on the presence of a license.
import { adminHtml } from "./admin.mjs";

const enc = new TextEncoder();
const decoder = new TextDecoder();
const MAX_JSON = 4096;
const OFFLINE_SECONDS = 7 * 86400;
let jwksCache = { expires: 0, keys: [] };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }
  });
}
function fail(code = "INVALID_AUTHORIZATION", status = 400) { return json({ error: code }, status); }
function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64(input) {
  const v = input.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(v + "=".repeat((4 - v.length % 4) % 4)), c => c.charCodeAt(0));
}
async function digest(s) {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
export function normalizeCode(code) {
  if (typeof code !== "string") return null;
  const s = code.trim().toUpperCase();
  return /^SF-(?:[0-9A-F]{8}-){3}[0-9A-F]{8}$/.test(s) ? s : null;
}
function isDeviceId(v) { return typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v); }
function now() { return Math.floor(Date.now() / 1000); }
async function readBody(req) {
  if (!(req.headers.get("content-type") || "").startsWith("application/json")) return null;
  if (Number(req.headers.get("content-length") || "0") > MAX_JSON) return null;
  const data = await req.text();
  if (data.length > MAX_JSON) return null;
  try { const value = JSON.parse(data); return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
  catch { return null; }
}
function checkConfig(env) { return !!(env.DB && env.CODE_PEPPER && env.LICENSE_PRIVATE_KEY && env.LICENSE_PUBLIC_KEY); }
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return "SF-" + hex.match(/.{8}/g).join("-");
}
async function importPrivate(env) {
  return crypto.subtle.importKey("pkcs8", fromB64(env.LICENSE_PRIVATE_KEY), "Ed25519", false, ["sign"]);
}
async function importPublic(env) {
  return crypto.subtle.importKey("raw", fromB64(env.LICENSE_PUBLIC_KEY), "Ed25519", false, ["verify"]);
}
async function sign(env, payload) {
  const raw = enc.encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("Ed25519", await importPrivate(env), raw);
  return b64url(raw) + "." + b64url(new Uint8Array(signature));
}
async function decodeLease(env, value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  try {
    const bytes = fromB64(parts[0]), sig = fromB64(parts[1]);
    if (bytes.length > 1200 || sig.length !== 64) return null;
    if (!await crypto.subtle.verify("Ed25519", await importPublic(env), sig, bytes)) return null;
    const claims = JSON.parse(decoder.decode(bytes));
    return claims.v === 1 && claims.kid === "v1" ? claims : null;
  } catch { return null; }
}
async function issueLease(env, code, binding, deviceHash) {
  const t = now();
  const deadline = code.expires_at === null ? 2147483647 : code.expires_at;
  const expiry = Math.min(t + OFFLINE_SECONDS, deadline);
  const claims = { v: 1, kid: "v1", license_id: code.id, binding_id: binding.id,
    device_hash: deviceHash, issued_at: t, expires_at: deadline,
    offline_until: expiry, features: ["community_distribution"] };
  return { lease: await sign(env, claims), expires_at: deadline, offline_until: expiry };
}
async function throttle(env, request) {
  const rawIP = request.headers.get("CF-Connecting-IP") || "local";
  const key = await digest("attempt:" + rawIP + ":" + env.CODE_PEPPER);
  const windowStart = Math.floor(now() / 600) * 600;
  await env.DB.prepare("INSERT INTO attempts (ip_hash, window_start, count) VALUES (?, ?, 1) ON CONFLICT(ip_hash) DO UPDATE SET window_start=excluded.window_start, count=CASE WHEN attempts.window_start=excluded.window_start THEN attempts.count+1 ELSE 1 END").bind(key, windowStart).run();
  const result = await env.DB.prepare("SELECT count FROM attempts WHERE ip_hash=?").bind(key).first();
  return result && result.count > 12;
}
async function activate(request, env) {
  const body = await readBody(request);
  if (!body || !isDeviceId(body.device_id)) return fail("INVALID_INPUT");
  if (await throttle(env, request)) return fail("RATE_LIMITED", 429);
  const value = normalizeCode(body.code);
  if (!value) return fail();
  const codeHash = await digest("license-code:" + value + ":" + env.CODE_PEPPER);
  const code = await env.DB.prepare("SELECT id, expires_at, revoked_at, max_devices FROM codes WHERE code_hash=?").bind(codeHash).first();
  const t = now();
  if (!code || code.revoked_at !== null || (code.expires_at !== null && code.expires_at <= t)) return fail();
  const deviceHash = await digest("device-v1:" + body.device_id);
  let binding = await env.DB.prepare("SELECT id FROM bindings WHERE code_id=? AND device_hash=? AND revoked_at IS NULL").bind(code.id, deviceHash).first();
  if (!binding) {
    const id = crypto.randomUUID();
    const inserted = await env.DB.prepare("INSERT INTO bindings (id,code_id,device_hash,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM bindings WHERE code_id=? AND revoked_at IS NULL) < (SELECT max_devices FROM codes WHERE id=? AND revoked_at IS NULL)").bind(id, code.id, deviceHash, t, code.id, code.id).run();
    if (!inserted.meta || inserted.meta.changes !== 1) return fail("DEVICE_LIMIT_REACHED", 409);
    binding = { id };
  }
  await env.DB.prepare("UPDATE bindings SET last_seen_at=? WHERE id=?").bind(t, binding.id).run();
  return json(await issueLease(env, code, binding, deviceHash));
}
async function currentBinding(request, env) {
  const body = await readBody(request);
  if (!body || !isDeviceId(body.device_id)) return null;
  const claims = await decodeLease(env, body.lease);
  if (!claims || claims.offline_until <= now()) return null;
  const deviceHash = await digest("device-v1:" + body.device_id);
  if (claims.device_hash !== deviceHash) return null;
  const row = await env.DB.prepare("SELECT b.id,b.revoked_at AS binding_revoked,c.id AS code_id,c.expires_at,c.revoked_at AS code_revoked,c.max_devices FROM bindings b JOIN codes c ON c.id=b.code_id WHERE b.id=? AND b.device_hash=? AND c.id=?").bind(claims.binding_id, deviceHash, claims.license_id).first();
  if (!row || row.binding_revoked !== null || row.code_revoked !== null ||
      (row.expires_at !== null && row.expires_at <= now())) return null;
  return { row, deviceHash };
}
async function refresh(request, env) {
  const state = await currentBinding(request, env);
  if (!state) return fail();
  await env.DB.prepare("UPDATE bindings SET last_seen_at=? WHERE id=?").bind(now(), state.row.id).run();
  return json(await issueLease(env, { id: state.row.code_id, expires_at: state.row.expires_at },
    { id: state.row.id }, state.deviceHash));
}
async function release(request, env) {
  const state = await currentBinding(request, env);
  if (!state) return fail();
  await env.DB.prepare("UPDATE bindings SET revoked_at=? WHERE id=?").bind(now(), state.row.id).run();
  return json({ released: true });
}
async function accessAllowed(request, env) {
  const domain = env.ACCESS_TEAM_DOMAIN || "";
  const audience = env.ACCESS_AUD || "";
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !audience) return false;
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt || jwt.length > 8192) return false;
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(decoder.decode(fromB64(parts[0])));
    const payload = JSON.parse(decoder.decode(fromB64(parts[1])));
    const t = now();
    if (header.alg !== "RS256" || typeof header.kid !== "string" ||
        payload.iss !== "https://" + domain || !Array.isArray(payload.aud) ||
        !payload.aud.includes(audience) || !Number.isSafeInteger(payload.exp) ||
        payload.exp <= t || (payload.nbf && payload.nbf > t)) return false;
    if (jwksCache.expires < t) {
      const response = await fetch("https://" + domain + "/cdn-cgi/access/certs");
      if (!response.ok) return false;
      const data = await response.json();
      jwksCache = { expires: t + 300, keys: Array.isArray(data.keys) ? data.keys : [] };
    }
    const jwk = jwksCache.keys.find(k => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
      fromB64(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  } catch { return false; }
}
async function admin(request, env, path) {
  if (!await accessAllowed(request, env)) return fail("ADMIN_UNAUTHORIZED", 403);
  if (request.method !== "GET" && request.headers.get("Origin") !== new URL(request.url).origin)
    return fail("INVALID_ORIGIN", 403);
  if (path === "/admin" && request.method === "GET") {
    return new Response(adminHtml, { headers: { "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
      "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff" } });
  }
  if (path === "/api/admin/codes" && request.method === "GET") {
    const items = await env.DB.prepare("SELECT id,label,max_devices,expires_at,created_at,revoked_at,(SELECT COUNT(*) FROM bindings WHERE code_id=c.id AND revoked_at IS NULL) AS active_devices FROM codes c ORDER BY created_at DESC LIMIT 100").all();
    return json({ codes: items.results });
  }
  if (path === "/api/admin/codes" && request.method === "POST") {
    const body = await readBody(request);
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    const limit = body?.max_devices;
    const exp = body?.expires_at;
    if (!label || label.length > 80 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10 ||
        !(exp === null || (Number.isSafeInteger(exp) && exp > now() && exp < 4102444800))) return fail("INVALID_INPUT");
    const code = randomCode(), id = crypto.randomUUID();
    const hash = await digest("license-code:" + code + ":" + env.CODE_PEPPER);
    await env.DB.prepare("INSERT INTO codes(id,code_hash,label,max_devices,expires_at,created_at) VALUES (?,?,?,?,?,?)").bind(id,hash,label,limit,exp,now()).run();
    return json({ id, code }, 201); // Raw code is returned only once, never stored.
  }
  if (path === "/api/admin/bindings" && request.method === "GET") {
    const licenseId = new URL(request.url).searchParams.get("license_id");
    if (!licenseId || !/^[0-9a-f-]{36}$/.test(licenseId)) return fail("INVALID_INPUT");
    const items = await env.DB.prepare("SELECT id,created_at,last_seen_at,revoked_at FROM bindings WHERE code_id=? ORDER BY created_at DESC LIMIT 100").bind(licenseId).all();
    return json({ bindings: items.results });
  }
  const revoke = /^\/api\/admin\/codes\/([0-9a-f-]{36})\/revoke$/.exec(path);
  if (revoke && request.method === "POST") {
    await env.DB.prepare("UPDATE codes SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(now(),revoke[1]).run();
    return json({ revoked: true });
  }
  const unbind = /^\/api\/admin\/bindings\/([0-9a-f-]{36})\/release$/.exec(path);
  if (unbind && request.method === "POST") {
    await env.DB.prepare("UPDATE bindings SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(now(),unbind[1]).run();
    return json({ released: true });
  }
  return fail("NOT_FOUND", 404);
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!checkConfig(env)) return fail("SERVICE_NOT_CONFIGURED", 503);
    if (path.startsWith("/admin") || path.startsWith("/api/admin/")) return admin(request, env, path);
    if (request.method !== "POST") return fail("NOT_FOUND", 404);
    try {
      if (path === "/v1/activate") return await activate(request, env);
      if (path === "/v1/refresh") return await refresh(request, env);
      if (path === "/v1/release") return await release(request, env);
    } catch { return fail("SERVICE_ERROR", 503); }
    return fail("NOT_FOUND", 404);
  }
};
