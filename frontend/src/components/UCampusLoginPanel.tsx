import {useEffect,useState,type MouseEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
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
  const [embeddedOpen,setEmbeddedOpen]=useState(false);
  const [embeddedBusy,setEmbeddedBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const clearSensitiveInputs=()=>{
    setCookie("");setAuthorization("");setAnnotator("");setSchoolId("");
  };
  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    void request<UCampusSessionInfo>({operation:"ucampus.session.info"})
      .then(value=>{if(active){setStatus(value);if(value.variant)setVariant(value.variant);}})
      .catch(()=>{if(active)setStatus(null);});
    return ()=>{active=false;};
  },[desktop]);
  const refreshStoredExpiry=async()=>{
    try{
      const info=await request<UCampusSessionInfo>({operation:"ucampus.session.info"});
      setStatus(info);
    }catch{
      // The previous successful save remains configured; never manufacture
      // a "connected" state from a failed local status read.
    }
  };
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
  const completeSessionSave=async(
    method:"official"|"password"|"manual",savedVariant:"ai"|"classic",monitorReset?:boolean
  )=>{
    setStatus({configured:true,variant:savedVariant,jwt_lifetime:"unknown"});
    await refreshStoredExpiry();
    if(method==="official")setVariant("ai");
    onChanged();
    const feedback={
      official:{
        ok:"已从官方登录窗口将会话保存到本机。",
        fail:"已从官方登录窗口保存会话，但课程读取失败：",
        suffix:"学习进度仍需独立核验。",
        failSuffix:""
      },
      password:{
        ok:"U校园 SSO 会话已保存。",
        fail:"U校园 SSO 会话已保存，但课程读取失败：",
        suffix:"单元和学习进度仍需分别核验。",
        failSuffix:""
      },
      manual:{
        ok:"会话已在本机保存。",
        fail:"会话已保存，但课程读取失败：",
        suffix:"课程读取成功不等于学习进度已核验。",
        failSuffix:"。保存成功不表示已登录或接口可用。"
      }
    }[method];
    const resetWarning=monitorReset===false?"旧自动核验记录未能清除，请检查本机存储权限。":"";
    try{
      const summary=await verifyCatalog();
      setNotice(feedback.ok+summary+feedback.suffix+resetWarning);
    }catch(error){
      setNotice(feedback.fail+friendlyBridgeError(error)+feedback.failSuffix+resetWarning);
    }
  };
  const openEmbeddedWindow=async(successMessage:string,failureMessage:string)=>{
    try{
      await invoke("ucampus_login_window_start");
      setEmbeddedOpen(true);
      setNotice(successMessage);
    }catch{
      setNotice(failureMessage);
    }
  };
  const openOfficial=(event:MouseEvent<HTMLAnchorElement>,mode:"ai"|"classic"|"qr")=>{
    if(!desktop)return;
    event.preventDefault();
    void invoke("ucampus_open_official_site",{mode})
      .catch(()=>setNotice("未能打开系统浏览器，请复制上方官方网站链接在浏览器中访问。"));
  };
  const launchEmbedded=async()=>{
    if(!desktop||busy||embeddedBusy)return;
    setEmbeddedBusy(true);setNotice("");
    try{
      await openEmbeddedWindow(
        "已打开 U校园官方登录窗口。如出现图片或数字验证码，请直接在官方页面查看并手动输入；也可按官方页面选择扫码。登录成功后返回学序，点击“导入并验证会话”。",
        "无法打开内置官方登录窗口。你仍可使用系统浏览器登录后手动导入 Cookie。"
      );
    }finally{setEmbeddedBusy(false);}
  };
  const importEmbedded=async()=>{
    if(!desktop||busy||embeddedBusy||!embeddedOpen)return;
    setBusy(true);setNotice("");
    try{
      const result=await invoke<{saved:boolean}>("ucampus_login_window_import");
      if(result?.saved!==true)throw Error("UCAMPUS_LOGIN_SAVE_FAILED");
      setEmbeddedOpen(false);
      await completeSessionSave("official","ai");
    }catch(error){
      if(error==="UCAMPUS_LOGIN_WINDOW_MISSING")setEmbeddedOpen(false);
      const message=typeof error==="string"?error:"";
      setNotice(message==="UCAMPUS_LOGIN_COOKIE_EXPIRED"
        ?"官方窗口里的 U校园 JWT 自报已经过期。请在官方窗口重新登录后再导入，旧 Cookie 不会覆盖本机已保存的会话。"
        :message==="UCAMPUS_LOGIN_COOKIE_MISSING"
          ?"暂未从官方窗口检测到 U校园AI 的 JWT 会话。请确认已在官方页面手动输入图片/数字验证码（或完成扫码）并完成页面跳转，或在下方手动导入 Cookie。"
        :message==="UCAMPUS_LOGIN_WINDOW_MISSING"
          ?"官方登录窗口已经关闭，请重新打开。"
          :"官方窗口会话导入失败。请确认已登录 U校园AI，或使用下方手动 Cookie 导入。");
    }finally{setBusy(false);}
  };
  const closeEmbedded=async()=>{
    if(!desktop||busy||embeddedBusy)return;
    setEmbeddedBusy(true);
    try{
      await invoke("ucampus_login_window_close");
      setEmbeddedOpen(false);
      setNotice("已关闭官方登录窗口。");
    }catch{setNotice("关闭登录窗口失败，请直接关闭弹出的官方窗口。");}
    finally{setEmbeddedBusy(false);}
  };
  const login=async()=>{
    if(!desktop||busy||variant!=="ai"||!username.trim()||!password)return;
    setBusy(true);setNotice("");
    try{
      const saved=await request<{saved:boolean;variant:"ai";monitor_reset:boolean}>({
        operation:"ucampus.session.login",username:username.trim(),password
      });
      if(saved.saved!==true)throw Error("UCAMPUS_CREDENTIAL_STORAGE_FAILED");
      setUsername("");
      await completeSessionSave("password","ai",saved.monitor_reset);
    }catch(error){
      if(error instanceof Error&&error.message==="UCAMPUS_LOGIN_VERIFICATION_REQUIRED"){
        // The direct SSO request cannot show the provider's challenge.
        // Let the user enter image/numeric CAPTCHA on the actual provider page.
        await openEmbeddedWindow(
          "U校园要求图片或数字验证码。已打开官方登录窗口，请在官方页面重新输入账号密码、查看验证码并手动填写。完成登录后返回学序，点击“导入并验证会话”。",
          "U校园要求图片或数字验证码，且官方登录窗口打开失败。请使用上方“打开 U校园官方网站”完成验证，再通过本机 Cookie 导入。"
        );
      }else{
        setNotice(friendlyBridgeError(error));
      }
    }finally{
      setPassword("");setBusy(false);
    }
  };
  const save=async()=>{
    if(!desktop||busy||(variant==="classic"&&!url.trim())||!cookie.trim())return;
    setBusy(true);setNotice("");
    try{
      const configuration:UCampusConfig={variant,catalog_url:url.trim(),cookie:cookie.trim().replace(/^cookie\s*:\s*/i,""),
        authorization:authorization.trim(),annotator_token:annotator.trim(),school_id:schoolId.trim()};
      const saved=await request<{saved:boolean;monitor_reset:boolean}>({operation:"ucampus.session.configure",configuration});
      if(saved.saved!==true)throw Error("UCAMPUS_CREDENTIAL_STORAGE_FAILED");
      clearSensitiveInputs();
      await completeSessionSave("manual",variant,saved.monitor_reset);
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
      const cleared=await request<{cleared:boolean;monitor_reset:boolean}>({operation:"ucampus.session.clear"});
      let windowWarning="";
      try{
        await invoke("ucampus_login_window_close");
        setEmbeddedOpen(false);
      }catch{
        windowWarning="官方网页登录窗口未能自动清理，请手动关闭该窗口。";
      }
      clearSensitiveInputs();setUsername("");setPassword("");setUrl("");
      setStatus({configured:false,variant:null,jwt_lifetime:"unknown"});
      setNotice("已清除学序保存的 U校园会话。"+windowWarning+
        (cleared.monitor_reset===false?"旧自动核验记录未能清除，请检查本机存储权限。":""));
      onChanged();
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  return <div className="sf-platform-settings-view sf-ucampus-login" aria-label="U校园账号与连接">
    <p className="sf-muted">U校园5.0 / AI版优先接入。服务器进度只读核验已接入，课程与进度须以本人账号实际读取结果核验。</p>
    <p className="sf-muted">{status?.configured?"本机已有会话配置（不代表接口已登录成功）":"本机尚未配置 U校园会话"}</p>
    {status?.configured&&status.jwt_lifetime==="expired"&&
      <p className="sf-ucampus-session-warning" role="status">本机 U校园 JWT 自报已过期，请重新完成官方登录。课程与进度读取不会继续使用该过期令牌。</p>}
    {status?.configured&&status.jwt_lifetime==="expiring"&&
      <p className="sf-ucampus-session-warning" role="status">本机 U校园 JWT 自报即将过期，建议重新登录。实际是否可用仍以服务器读取为准。</p>}
    <div className="sf-settings-line">
      <label htmlFor="ucampus-variant">平台版本</label>
      <select id="ucampus-variant" value={variant} disabled={!desktop||busy}
        onChange={e=>setVariant(e.target.value as "ai"|"classic")}>
        <option value="ai">U校园5.0 · AI版</option>
        <option value="classic">U校园普通版</option>
      </select>
    </div>
    <section className="sf-ucampus-official-login" aria-label="U校园官方验证入口">
      <strong>推荐：先在官方页面完成登录验证</strong>
      <p className="sf-muted">官方页面支持账号登录；如出现图片或数字验证码，请查看图片并在官方页面手动输入。扫码属于另一种登录方式，不是短信验证码。</p>
      {variant==="ai"&&<div className="actions">
        <button type="button" className="primary" disabled={!desktop||busy||embeddedBusy}
          onClick={()=>void launchEmbedded()}>打开官方登录（图片 / 数字验证码或扫码）</button>
        <button type="button" className="secondary" disabled={!desktop||busy||embeddedBusy||!embeddedOpen}
          onClick={()=>void importEmbedded()}>完成验证，导入并验证会话</button>
        {embeddedOpen&&<button type="button" className="secondary" disabled={!desktop||busy||embeddedBusy}
          onClick={()=>void closeEmbedded()}>关闭官方登录窗口</button>}
      </div>}
      <div className="actions">
        <a className="sf-ucampus-official-link" href={variant==="ai"?"https://uai.unipus.cn/":"https://u.unipus.cn/"}
          target="_blank" rel="noopener noreferrer" onClick={event=>openOfficial(event,variant)}>打开 U校园官方网站</a>
        <a className="sf-ucampus-official-link secondary" href="https://sso.unipus.cn/sso/login"
          target="_blank" rel="noopener noreferrer" onClick={event=>openOfficial(event,"qr")}>打开官方扫码登录页</a>
      </div>
      <p className="sf-muted">应用内官方窗口可尝试读取网站签发给 U校园AI 的 JWT，成功后仅写入本机 Windows 凭据管理器；不同账号或平台流程可能无法提供该 Cookie。系统浏览器登录不能直接同步到学序，此时请使用下方手动导入。不要分享 Cookie。</p>
    </section>
    {variant==="ai"&&<details className="sf-ucampus-password-login">
      <summary>备用：账号密码直接接口（需要验证码时自动打开官方页面）</summary>
      <div className="sf-platform-settings-view" aria-label="U校园 SSO 账号密码登录">
      <p className="sf-muted">账号密码登录（实验接入）：由学序本机请求 U校园 SSO；不保存账号密码，仅将服务端返回的会话写入 Windows 凭据管理器。如果需要图片或数字验证码，学序会打开官方页面供你查看并手动填写；不会要求手机短信验证码。</p>
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
      </div>
    </details>}
    <details className="sf-ucampus-cookie-import">
      <summary>高级：手动导入现有会话</summary>
      <p className="sf-muted">在已登录的 U校园官方页面获取本人有效 Cookie，粘贴到下方。AI版课程 URL 可留空，其他令牌仅在接口明确需要时填写。</p>
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
