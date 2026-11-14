import {useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {BookOpen,ShieldCheck,X} from "lucide-react";
import {friendlyBridgeError,type ZhidaoDocument} from "../bridge";

type Props={desktop:boolean;dark:boolean;onAccepted?:()=>void};
type Phase="checking"|"required"|"accepted"|"error";
type Tab="terms"|"privacy";
export function StudyFlowConsentGate({desktop,dark,onAccepted}:Props){
  const [phase,setPhase]=useState<Phase>(desktop?"checking":"accepted");
  const [tab,setTab]=useState<Tab>("terms");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [docs,setDocs]=useState<{terms:ZhidaoDocument|null;privacy:ZhidaoDocument|null}>({
    terms:null,privacy:null
  });

  async function load(){
    setPhase("checking");setMessage("");
    try{
      const status=await invoke<{accepted:boolean}>("studyflow_consent_status");
      if(status.accepted){setPhase("accepted");onAccepted?.();return;}
      const [terms,privacy]=await Promise.all([
        invoke<ZhidaoDocument>("studyflow_read_document",{documentId:"terms"}),
        invoke<ZhidaoDocument>("studyflow_read_document",{documentId:"privacy"})
      ]);
      setDocs({terms,privacy});setPhase("required");
    }catch(error){setMessage(friendlyBridgeError(error));setPhase("error");}
  }

  useEffect(()=>{
    if(desktop)void load();
    else setPhase("accepted");
  },[desktop]);

  async function accept(){
    if(!docs.terms||!docs.privacy)return;
    setBusy(true);setMessage("");
    try{
      const result=await invoke<{accepted:boolean}>("studyflow_consent_accept");
      if(result.accepted){setPhase("accepted");onAccepted?.();}
      else setMessage("声明状态未能确认保存，请重试。");
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(false);}
  }

  if(!desktop||phase==="accepted")return null;
  return <div className="sf-consent-overlay" data-theme={dark?"dark":"light"}>
    <section className="sf-consent-dialog" role="dialog" aria-modal="true"
      aria-labelledby="sf-consent-title">
      <header className="sf-consent-header">
        <span><ShieldCheck size={20}/></span>
        <div><h2 id="sf-consent-title">学序首次使用声明</h2>
          <p>继续使用前，请阅读第三方声明与隐私数据说明。</p></div>
        <button className="sf-consent-exit" type="button"
          onClick={()=>void invoke("studyflow_exit")} aria-label="退出学序" title="退出学序">
          <X size={16}/><span>退出学序</span>
        </button>
      </header>
      {phase==="checking"&&<div className="sf-consent-loading">正在读取本机声明文件…</div>}
      {phase==="error"&&<div className="sf-consent-error" role="alert">
        <p>{message||"无法读取首次使用声明，暂不能继续。请检查安装包资源。"}</p>
        <button className="secondary" type="button" onClick={()=>void load()}>重新读取</button>
      </div>}
      {phase==="required"&&<>
        <nav className="sf-consent-tabs" aria-label="首次使用声明文档">
          <button type="button" aria-pressed={tab==="terms"} className={tab==="terms"?"active":""}
            onClick={()=>setTab("terms")}><BookOpen size={14}/>第三方使用声明</button>
          <button type="button" aria-pressed={tab==="privacy"} className={tab==="privacy"?"active":""}
            onClick={()=>setTab("privacy")}><ShieldCheck size={14}/>隐私与数据说明</button>
        </nav>
        <div className="sf-consent-document">
          <h3>{docs[tab]?.title}</h3>
          <pre>{docs[tab]?.content}</pre>
        </div>
        <p className="sf-consent-confirmation">
          点击“同意并继续使用”即表示你已阅读并同意上述第三方使用声明及隐私与数据说明。
        </p>
        {message&&<p className="sf-consent-message" role="alert">{message}</p>}
        <footer className="sf-consent-actions">
          <button className="primary" type="button" disabled={!docs.terms||!docs.privacy||busy}
            onClick={()=>void accept()}>{busy?"正在保存…":"同意并继续使用"}</button>
        </footer>
      </>}
    </section>
  </div>;
}
