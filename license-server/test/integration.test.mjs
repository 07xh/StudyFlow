import {test} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync, randomUUID} from "node:crypto";
import worker from "../src/index.mjs";

const enc=new TextEncoder();
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s)))]
  .map(v=>v.toString(16).padStart(2,"0")).join("");
function env(){
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  return {CODE_PEPPER:"test-only",LICENSE_PRIVATE_KEY:privateKey.export({format:"der",type:"pkcs8"}).toString("base64"),
    LICENSE_PUBLIC_KEY:publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("base64"),
    DB:new FakeD1()};
}
class FakeD1 {
  constructor(){this.codes=[];this.bindings=[];this.attempts=new Map();}
  prepare(sql){const db=this;return {bind(...a){return {
    async first(){
      if(sql.startsWith("SELECT count FROM attempts"))return {count:db.attempts.get(a[0])?.count||0};
      if(sql.includes("FROM codes WHERE code_hash"))return db.codes.find(x=>x.code_hash===a[0])||null;
      if(sql.includes("FROM bindings WHERE code_id="))
        return db.bindings.find(x=>x.code_id===a[0]&&x.device_hash===a[1]&&x.revoked_at===null)||null;
      if(sql.includes("FROM bindings b JOIN codes c")){
        const b=db.bindings.find(x=>x.id===a[0]&&x.device_hash===a[1]);
        const c=db.codes.find(x=>x.id===a[2]&&x.id===b?.code_id);
        return b&&c?{id:b.id,binding_revoked:b.revoked_at,code_id:c.id,expires_at:c.expires_at,
          code_revoked:c.revoked_at,max_devices:c.max_devices}:null;
      }
      throw Error("Unexpected SELECT");
    },
    async run(){
      if(sql.startsWith("INSERT INTO attempts")){
        const prior=db.attempts.get(a[0]);
        db.attempts.set(a[0],{window_start:a[1],count:prior?.window_start===a[1]?prior.count+1:1});
        return {meta:{changes:1}};
      }
      if(sql.startsWith("INSERT INTO bindings")){
        const used=db.bindings.filter(x=>x.code_id===a[1]&&x.revoked_at===null).length;
        const code=db.codes.find(x=>x.id===a[1]);
        if(used>=code.max_devices)return {meta:{changes:0}};
        db.bindings.push({id:a[0],code_id:a[1],device_hash:a[2],created_at:a[3],revoked_at:null});
        return {meta:{changes:1}};
      }
      if(sql.startsWith("UPDATE bindings SET last_seen_at"))return {meta:{changes:1}};
      if(sql.startsWith("UPDATE bindings SET revoked_at")){
        db.bindings.find(x=>x.id===a[1]).revoked_at=a[0];return {meta:{changes:1}};
      }
      throw Error("Unexpected write");
    }
  };}};}
}
async function post(e,path,payload){
  const r=await worker.fetch(new Request("https://test.example"+path,{method:"POST",
    headers:{"content-type":"application/json","cf-connecting-ip":"192.0.2.1"},body:JSON.stringify(payload)}),e);
  return {status:r.status,body:await r.json()};
}
test("activate, device quota, idempotency, refresh, release, revocation",async()=>{
  const e=env(),code="SF-12345678-12345678-12345678-12345678";
  e.DB.codes.push({id:randomUUID(),code_hash:await hash("license-code:"+code+":"+e.CODE_PEPPER),
    max_devices:1,expires_at:null,revoked_at:null});
  const first=randomUUID(), second=randomUUID();
  const a=await post(e,"/v1/activate",{code,device_id:first});
  assert.equal(a.status,200);assert.equal(a.body.lease.split(".").length,2);
  assert.equal((await post(e,"/v1/activate",{code,device_id:first})).status,200);
  assert.equal(e.DB.bindings.length,1);
  assert.equal((await post(e,"/v1/activate",{code,device_id:second})).status,409);
  assert.equal((await post(e,"/v1/refresh",{lease:a.body.lease,device_id:first})).status,200);
  assert.equal((await post(e,"/v1/refresh",{lease:a.body.lease,device_id:second})).status,400);
  assert.equal((await post(e,"/v1/release",{lease:a.body.lease,device_id:first})).status,200);
  assert.equal((await post(e,"/v1/refresh",{lease:a.body.lease,device_id:first})).status,400);
  assert.equal((await post(e,"/v1/activate",{code,device_id:second})).status,200);
  e.DB.codes[0].revoked_at=1;
  assert.equal((await post(e,"/v1/activate",{code,device_id:second})).status,400);
});
