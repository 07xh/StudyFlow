import {useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";

type LicenseState = "not_configured"|"not_activated"|"active_offline"|
  "expired_or_invalid"|"clock_error";
type Status = {state:LicenseState;license_id?:string;expires_at?:number;offline_until?:number};

const friendly:Record<string,string>={
  LICENSE_NOT_CONFIGURED:"此安装包尚未配置授权服务；原有学习功能不受影响。",
  LICENSE_STORAGE_UNAVAILABLE:"无法访问 Windows 本地授权存储。",
  LICENSE_CACHE_INVALID:"本地授权缓存损坏；请联系发码人处理。",
  LICENSE_DPAPI_FAILED:"Windows 用户凭据已变化，无法解密授权缓存。",
  LICENSE_CLOCK_ERROR:"系统时间异常，请校准时间后重试。",
  LICENSE_CODE_INVALID:"激活码格式不正确。",
  LICENSE_REJECTED:"激活码无效、已撤销或已过期。",
  LICENSE_DEVICE_LIMIT:"设备名额已用完，请联系发码人释放旧设备。",
  LICENSE_RATE_LIMITED:"操作过于频繁，请稍后再试。",
  LICENSE_NETWORK_ERROR:"无法连接授权服务；已有有效的离线许可仍可查看。",
  LICENSE_INVALID_OR_EXPIRED:"许可证签名无效或离线有效期已经结束。",
  LICENSE_SERVER_INVALID:"授权服务返回了无效的签名数据。",
  LICENSE_SERVICE_ERROR:"授权服务器暂时不可用，请稍后重试。"
};
const stateLabel:Record<LicenseState,string>={
  not_configured:"未配置授权服务",
  not_activated:"尚未激活",
  active_offline:"已激活（本机签名已验证）",
  expired_or_invalid:"授权过期或无法验证",
  clock_error:"系统时间异常"
};
function formatDate(seconds?:number){
  if(seconds===undefined)return "—";
  return seconds>=2147483647?"长期":new Date(seconds*1000).toLocaleString();
}

export function LicensePanel({desktop,visible}:{desktop:boolean;visible:boolean}){
  const [status,setStatus]=useState<Status|null>(null);
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  async function action<T>(fn:()=>Promise<T>,done:(value:T)=>void){
    setBusy(true);setMessage("");
    try{done(await fn());}catch(error){
      const raw=error instanceof Error?error.message:String(error);
      setMessage(friendly[raw]||"授权操作失败，请查看网络与安装包配置。");
    }finally{setBusy(false);}
  }
  async function query(){return invoke<Status>("license_status");}
  useEffect(()=>{
    if(!desktop||!visible)return;
    let alive=true;
    void query().then(value=>{if(alive)setStatus(value);})
      .catch(()=>{if(alive)setMessage("本地授权状态读取失败。");});
    return ()=>{alive=false;};
  },[desktop,visible]);

  if(!visible)return null;
  return <section className="settings-card" aria-labelledby="studyflow-license-title">
    <div className="section-head">
      <h3 id="studyflow-license-title">分享授权</h3>
      <span role="status">{status?stateLabel[status.state]:"读取中"}</span>
    </div>
    <div className="sf-settings-line">
      <div><strong>本机授权</strong>
        <p>授权仅用于小范围分享与设备管理，不影响学序已有的 GPL 学习功能。</p>
        {status?.state==="active_offline"&&<>
          <p>授权编号：{status.license_id}</p>
          <p>到期日期：{formatDate(status.expires_at)}</p>
          <p>离线验证有效至：{formatDate(status.offline_until)}</p>
        </>}
      </div>
    </div>
    <div className="sf-settings-line">
      <label htmlFor="sf-license-code">激活码</label>
      <input id="sf-license-code" type="text" spellCheck={false}
        autoComplete="off" autoCapitalize="characters" placeholder="SF-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
        value={code} onChange={event=>setCode(event.target.value.toUpperCase())}
        disabled={!desktop||busy} maxLength={64} style={{width:"min(100%, 390px)"}}/>
    </div>
    <div className="actions">
      <button className="primary" type="button" disabled={!desktop||busy||!code.trim()}
        onClick={()=>void action(()=>invoke<Status>("license_activate",{code:code.trim()}),
          value=>{setStatus(value);setCode("");setMessage("激活成功，已安全保存离线许可证。");})}>
        {busy?"处理中…":"激活"}
      </button>
      <button className="secondary" type="button" disabled={!desktop||busy}
        onClick={()=>void action(query,setStatus)}>读取状态</button>
      <button className="secondary" type="button" disabled={!desktop||busy||status?.state!=="active_offline"}
        onClick={()=>void action(()=>invoke<Status>("license_refresh"),
          value=>{setStatus(value);setMessage("授权已向服务器续签。");})}>在线续签</button>
      <button className="secondary" type="button" disabled={!desktop||busy||status?.state!=="active_offline"}
        onClick={()=>{if(window.confirm("释放当前设备授权？离线时无法释放，请确保联网。"))
          void action(()=>invoke<Status>("license_release"),
            value=>{setStatus(value);setMessage("当前设备授权已释放。");});}}>释放设备</button>
    </div>
    {message&&<p role="status">{message}</p>}
    {!desktop&&<p>此区域仅在 Windows 桌面版中进行真实授权验证。</p>}
  </section>;
}
