import {useEffect,useState} from "react";
import {friendlyBridgeError,request,type UCampusConfig,type UCampusSessionInfo} from "../bridge";

/** No credentials enter localStorage, diagnostics or course state. */
export function UCampusLoginPanel({desktop,onChanged}:{desktop:boolean;onChanged:()=>void}){
  const [variant,setVariant]=useState<"ai"|"classic">("ai");
  const [url,setUrl]=useState("");
  const [cookie,setCookie]=useState("");
  const [authorization,setAuthorization]=useState("");
  const [annotator,setAnnotator]=useState("");
  const [schoolId,setSchoolId]=useState("");
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
    if(!desktop||busy||(variant==="classic"&&!url.trim())||!cookie.trim())return;
    setBusy(true);setNotice("");
    try{
      const configuration:UCampusConfig={variant,catalog_url:url.trim(),cookie:cookie.trim(),
        authorization:authorization.trim(),annotator_token:annotator.trim(),school_id:schoolId.trim()};
      await request<{saved:boolean}>({operation:"ucampus.session.configure",configuration});
      setCookie("");setAuthorization("");setAnnotator("");setSchoolId("");
      setStatus({configured:true,variant});
      setNotice("已保存本地会话；正在尝试开源项目中已知的 U校园课程接口。是否可用以真实账号返回为准。");
      onChanged();
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  const clear=async()=>{
    if(!desktop||busy)return;
    setBusy(true);setNotice("");
    try{
      await request<{cleared:boolean}>({operation:"ucampus.session.clear"});
      setCookie("");setAuthorization("");setAnnotator("");setSchoolId("");setUrl("");setStatus({configured:false,variant:null});
      setNotice("已清除学序保存的 U校园会话。");
      onChanged();
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  return <div className="sf-platform-settings-view" aria-label="U校园账号与连接">
    <p className="sf-muted">优先适配 U校园5.0 / AI版。已参考成熟开源项目接入首页课程列表及书架只读接口；是否适配你的账号仍需核验。暂不支持课程学习运行与服务器进度。</p>
    <p className="sf-muted">{status?.configured?"本机已有会话配置（不代表接口已登录成功）":"本机尚未配置 U校园会话"}</p>
    <div className="sf-settings-line">
      <label htmlFor="ucampus-variant">平台版本</label>
      <select id="ucampus-variant" value={variant} disabled={!desktop||busy}
        onChange={e=>setVariant(e.target.value as "ai"|"classic")}>
        <option value="ai">U校园5.0 · AI版</option>
        <option value="classic">U校园普通版</option>
      </select>
    </div>
    <label htmlFor="ucampus-catalog-url">{variant==="ai"?"课程接口 URL（留空使用开源项目已知首页接口）":"普通版课程接口 URL（必须使用本人已核验地址）"}</label>
    <input id="ucampus-catalog-url" type="url" autoComplete="off" spellCheck={false}
      placeholder={variant==="ai"?"默认使用 U校园AI版首页课程接口":"仅支持 U校园官方 HTTPS JSON 接口"} value={url}
      onChange={e=>setUrl(e.target.value)} disabled={!desktop||busy}/>
    <label htmlFor="ucampus-cookie">当前有效会话 Cookie</label>
    <input id="ucampus-cookie" type="password" autoComplete="off" spellCheck={false}
      placeholder="仅在学序本机配置，不发送到聊天或仓库" value={cookie}
      onChange={e=>setCookie(e.target.value)} disabled={!desktop||busy}/>
    <label htmlFor="ucampus-auth">Authorization（可选）</label>
    <input id="ucampus-auth" type="password" autoComplete="off" spellCheck={false}
      placeholder="仅实际请求确实需要时填写" value={authorization}
      onChange={e=>setAuthorization(e.target.value)} disabled={!desktop||busy}/>
    {variant==="ai"&&<>
      <label htmlFor="ucampus-annotator">U校园内容授权令牌（可选）</label>
      <input id="ucampus-annotator" type="password" autoComplete="off" spellCheck={false}
        placeholder="仅内容接口要求时填写，保存在本机" value={annotator}
        onChange={e=>setAnnotator(e.target.value)} disabled={!desktop||busy}/>
      <label htmlFor="ucampus-school">学校编号（可选）</label>
      <input id="ucampus-school" type="text" autoComplete="off" inputMode="numeric"
        placeholder="仅内容接口要求时填写" value={schoolId}
        onChange={e=>setSchoolId(e.target.value)} disabled={!desktop||busy}/>
    </>}
    <div className="actions">
      <button type="button" disabled={!desktop||busy||(variant==="classic"&&!url.trim())||!cookie.trim()} onClick={()=>void save()}>保存并检测连接</button>
      <button type="button" className="secondary" disabled={!desktop||busy||!status?.configured} onClick={()=>void clear()}>退出并清除</button>
    </div>
    {notice&&<p role="status">{notice}</p>}
    <p className="sf-muted">接口来源：Zzj-klwgxdz/UnipusAI（GPL-3.0）。未支持的课程学习、心跳发送、进度核验不会被标为成功；此处不会生成演示课程。</p>
  </div>;
}
