import {useEffect,useState} from "react";
import {friendlyBridgeError,request,type UCampusConfig,type UCampusSessionInfo} from "../bridge";
import type {Course} from "../types";

/** No credentials enter localStorage, diagnostics or course state. */
export function UCampusLoginPanel({desktop,onChanged}:{desktop:boolean;onChanged:()=>void}){
  const [variant,setVariant]=useState<"ai"|"classic">("ai");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [url,setUrl]=useState("");
  const [cookie,setCookie]=useState("");
  const [authorization,setAuthorization]=useState("");
  const [annotator,setAnnotator]=useState("");
  const [schoolId,setSchoolId]=useState("");
  const [status,setStatus]=useState<UCampusSessionInfo|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const clearSensitiveInputs=()=>{
    setCookie("");setAuthorization("");setAnnotator("");setSchoolId("");
  };
  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    void request<UCampusSessionInfo>({operation:"ucampus.session.info"})
      .then(value=>{if(active)setStatus(value);})
      .catch(()=>{if(active)setStatus(null);});
    return ()=>{active=false;};
  },[desktop]);
  const verifyCatalog=async():Promise<string>=>{
    const courses=await request<Course[]>({operation:"courses.list",platform:"ucampus"});
    if(!Array.isArray(courses)||!courses.every(course=>
      course&&course.platform==="ucampus"&&typeof course.course_id==="string"&&
      course.course_id.length>0&&typeof course.title==="string"&&course.title.length>0
    ))throw Error("INVALID_IPC_RESPONSE");
    return courses.length>0
      ?`课程接口已验证：实际读取到 ${courses.length} 门 U校园课程。`
      :"课程接口返回空列表：请求成功，但尚不能确认该账号已有课程或已完成登录验收。";
  };
  const login=async()=>{
    if(!desktop||busy||variant!=="ai"||!username.trim()||!password)return;
    setBusy(true);setNotice("");
    try{
      await request<{saved:boolean;variant:"ai"}>({
        operation:"ucampus.session.login",username:username.trim(),password
      });
      setStatus({configured:true,variant:"ai"});
      setUsername("");
      onChanged();
      try{
        const summary=await verifyCatalog();
        setNotice("U校园 SSO 会话已保存。"+summary+"单元和学习进度仍需分别核验。");
      }catch(catalogError){
        setNotice("U校园 SSO 会话已保存，但课程读取失败："+friendlyBridgeError(catalogError));
      }
    }catch(error){
      setNotice(friendlyBridgeError(error));
    }finally{
      setPassword("");setBusy(false);
    }
  };
  const save=async()=>{
    if(!desktop||busy||(variant==="classic"&&!url.trim())||!cookie.trim())return;
    setBusy(true);setNotice("");
    try{
      const configuration:UCampusConfig={variant,catalog_url:url.trim(),cookie:cookie.trim(),
        authorization:authorization.trim(),annotator_token:annotator.trim(),school_id:schoolId.trim()};
      await request<{saved:boolean}>({operation:"ucampus.session.configure",configuration});
      clearSensitiveInputs();
      setStatus({configured:true,variant});
      setNotice("已在本机保存会话。保存成功不表示已登录或接口可用，请点击“验证课程读取”核验当前账号。");
      onChanged();
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  const verify=async()=>{
    if(!desktop||busy||!status?.configured)return;
    setBusy(true);setNotice("");
    try{
      setNotice(await verifyCatalog());
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  const clear=async()=>{
    if(!desktop||busy)return;
    setBusy(true);setNotice("");
    try{
      await request<{cleared:boolean}>({operation:"ucampus.session.clear"});
      clearSensitiveInputs();setUsername("");setPassword("");setUrl("");setStatus({configured:false,variant:null});
      setNotice("已清除学序保存的 U校园会话。");
      onChanged();
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  return <div className="sf-platform-settings-view" aria-label="U校园账号与连接">
    <p className="sf-muted">优先适配 U校园5.0 / AI版。已参考成熟开源项目接入首页课程列表及书架只读接口；是否适配你的账号仍需核验。服务器进度只读核验已接入，是否适配当前账号仍需实际验证；本地练习与服务器完成状态分开显示。</p>
    <p className="sf-muted">{status?.configured?"本机已有会话配置（不代表接口已登录成功）":"本机尚未配置 U校园会话"}</p>
    <div className="sf-settings-line">
      <label htmlFor="ucampus-variant">平台版本</label>
      <select id="ucampus-variant" value={variant} disabled={!desktop||busy}
        onChange={e=>setVariant(e.target.value as "ai"|"classic")}>
        <option value="ai">U校园5.0 · AI版</option>
        <option value="classic">U校园普通版</option>
      </select>
    </div>
    {variant==="ai"&&<div className="sf-platform-settings-view" aria-label="U校园 SSO 账号密码登录">
      <p className="sf-muted">账号密码登录（实验接入）：由学序本机请求 U校园 SSO；不保存账号密码，仅将服务端返回的会话写入 Windows 凭据管理器。若出现验证码，请转到官方页面完成。</p>
      <label htmlFor="ucampus-username">U校园账号</label>
      <input id="ucampus-username" type="text" autoComplete="username" spellCheck={false}
        value={username} onChange={e=>setUsername(e.target.value)} disabled={!desktop||busy}
        maxLength={128} placeholder="输入本人 U校园账号"/>
      <label htmlFor="ucampus-password">登录密码</label>
      <input id="ucampus-password" type="password" autoComplete="current-password"
        value={password} onChange={e=>setPassword(e.target.value)} disabled={!desktop||busy}
        maxLength={256} placeholder="密码仅用于本次认证"/>
      <div className="actions">
        <button type="button" disabled={!desktop||busy||!username.trim()||!password}
          onClick={()=>void login()}>账号密码登录</button>
      </div>
    </div>}
    <details>
      <summary>高级：手动导入现有会话</summary>
      <p className="sf-muted">账号密码登录无法完成时，可从本人已登录的官方页面导入有效会话。敏感信息只应在本机输入。</p>
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
      <button type="button" disabled={!desktop||busy||(variant==="classic"&&!url.trim())||!cookie.trim()} onClick={()=>void save()}>保存会话</button>
    </div>
    </details>
    <div className="actions">
      <button type="button" className="secondary" disabled={!desktop||busy||!status?.configured} onClick={()=>void verify()}>验证课程读取</button>
      <button type="button" className="secondary" disabled={!desktop||busy||!status?.configured} onClick={()=>void clear()}>退出并清除</button>
    </div>
    {notice&&<p role="status">{notice}</p>}
    <p className="sf-muted">接口来源：Zzj-klwgxdz/UnipusAI（GPL-3.0）。课程和进度只以真实服务器响应为准；本地事件和发送结果不会自动算作课程完成，此处不会生成演示课程。</p>
  </div>;
}
