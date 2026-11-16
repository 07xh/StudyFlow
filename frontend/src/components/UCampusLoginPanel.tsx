import {useEffect,useState} from "react";
import {friendlyBridgeError,request,type UCampusConfig,type UCampusSessionInfo} from "../bridge";

/** No credentials enter localStorage, diagnostics or course state. */
export function UCampusLoginPanel({desktop,onChanged}:{desktop:boolean;onChanged:()=>void}){
  const [variant,setVariant]=useState<"ai"|"classic">("ai");
  const [url,setUrl]=useState("");
  const [cookie,setCookie]=useState("");
  const [authorization,setAuthorization]=useState("");
  const [status,setStatus]=useState<UCampusSessionInfo|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    void request<UCampusSessionInfo>({operation:"ucampus.session.info"})
      .then(value=>{if(active)setStatus(value);})
      .catch(()=>{if(active)setStatus(null);});
    return ()=>{active=false;};
  },[desktop]);
  const save=async()=>{
    if(!desktop||busy||!url.trim()||!cookie.trim())return;
    setBusy(true);setNotice("");
    try{
      const configuration:UCampusConfig={variant,catalog_url:url.trim(),cookie:cookie.trim(),authorization:authorization.trim()};
      await request<{saved:boolean}>({operation:"ucampus.session.configure",configuration});
      setCookie("");setAuthorization("");
      setStatus({configured:true,variant});
      setNotice("会话已保存；将使用已配置的真实 GET 课程接口验证登录。若接口不匹配，仍显示未连接。");
      onChanged();
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  const clear=async()=>{
    if(!desktop||busy)return;
    setBusy(true);setNotice("");
    try{
      await request<{cleared:boolean}>({operation:"ucampus.session.clear"});
      setCookie("");setAuthorization("");setUrl("");setStatus({configured:false,variant:null});
      setNotice("已清除学序保存的 U校园会话。");
      onChanged();
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  return <div className="sf-platform-settings-view" aria-label="U校园账号与连接">
    <p className="sf-muted">优先适配 U校园5.0 / AI版。当前为实验性只读接口：仅支持本人已核验的 HTTPS GET JSON 课程列表，不保证移动端和网页端接口相同。</p>
    <p className="sf-muted">{status?.configured?"本机已有会话配置（不代表接口已登录成功）":"本机尚未配置 U校园会话"}</p>
    <div className="sf-settings-line">
      <label htmlFor="ucampus-variant">平台版本</label>
      <select id="ucampus-variant" value={variant} disabled={!desktop||busy}
        onChange={e=>setVariant(e.target.value as "ai"|"classic")}>
        <option value="ai">U校园5.0 · AI版</option>
        <option value="classic">U校园普通版</option>
      </select>
    </div>
    <label htmlFor="ucampus-catalog-url">本人已核验的课程列表 GET 接口 URL</label>
    <input id="ucampus-catalog-url" type="url" autoComplete="off" spellCheck={false}
      placeholder="仅允许 U校园官方域名的 HTTPS JSON 接口" value={url}
      onChange={e=>setUrl(e.target.value)} disabled={!desktop||busy}/>
    <label htmlFor="ucampus-cookie">当前有效会话 Cookie</label>
    <input id="ucampus-cookie" type="password" autoComplete="off" spellCheck={false}
      placeholder="仅在学序本机配置，不发送到聊天或仓库" value={cookie}
      onChange={e=>setCookie(e.target.value)} disabled={!desktop||busy}/>
    <label htmlFor="ucampus-auth">Authorization（可选）</label>
    <input id="ucampus-auth" type="password" autoComplete="off" spellCheck={false}
      placeholder="仅实际请求确实需要时填写" value={authorization}
      onChange={e=>setAuthorization(e.target.value)} disabled={!desktop||busy}/>
    <div className="actions">
      <button type="button" disabled={!desktop||busy||!url.trim()||!cookie.trim()} onClick={()=>void save()}>保存并检测连接</button>
      <button type="button" className="secondary" disabled={!desktop||busy||!status?.configured} onClick={()=>void clear()}>退出并清除</button>
    </div>
    {notice&&<p role="status">{notice}</p>}
    <p className="sf-muted">没有经过核验的接口时，请勿随意填写网址；当前不支持直接使用移动端截图登录，也不会生成演示课程。</p>
  </div>;
