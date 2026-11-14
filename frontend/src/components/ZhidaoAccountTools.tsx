import {useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {BookOpen,Database,ExternalLink,FileText,FolderOpen,KeyRound,ShieldCheck,Trash2} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoDiagnostic,type ZhidaoDocument} from "../bridge";
import {ConfirmDialog} from "../ui/ConfirmDialog";

type Action="session"|"cache"|"web"|"none";
type Props={desktop:boolean;dark:boolean;onDataChanged?:()=>void};
const details={
  session:{
    title:"退出知到登录？",
    description:"删除本机 ZHS Cookie 和临时二维码。",
    warning:"课程缓存、学习进度缓存和官方服务器记录均保留；此操作不会撤销平台服务器上的其他会话。"
  },
  cache:{
    title:"清理知到课程缓存？",
    description:"删除本机保存的课程列表与学习进度缓存。",
    warning:"不会删除 Cookie、登录会话、官方网页数据，也不会修改服务器记录。"
  },
  web:{
    title:"清除官方网页登录数据？",
    description:"删除学序内嵌 WebView2 的本机 Cookie、会话和缓存。",
    warning:"不会删除 ZHS Python 登录态。请先关闭官方播放器窗口。"
  }
} as const;
const docs=[{id:"terms" as const,label:"使用条款与第三方声明",icon:FileText},
  {id:"privacy" as const,label:"隐私政策与数据说明",icon:ShieldCheck},
  {id:"license" as const,label:"GNU GPL v3 开源许可",icon:BookOpen},
  {id:"source" as const,label:"原版源码与来源",icon:Database}];

export function ZhidaoAccountTools({desktop,dark,onDataChanged}:Props){
  const [action,setAction]=useState<Action>("none");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [diagnostic,setDiagnostic]=useState<ZhidaoDiagnostic|null>(null);
  const [document,setDocument]=useState<ZhidaoDocument|null>(null);
  const [documentBusy,setDocumentBusy]=useState(false);

  async function runAction(){
    if(action==="none")return;
    setBusy(true);setMessage("");
    try{
      if(action==="session"){
        const result=await request<{removed:number}>({operation:"zhidao.session.clear"});
        setMessage("已删除 "+result.removed+" 个本机登录文件；课程缓存已保留。");
        onDataChanged?.();
      }else if(action==="cache"){
        const result=await request<{removed:number}>({operation:"zhidao.cache.clear"});
        setMessage("已删除 "+result.removed+" 个课程/进度缓存文件；登录凭据已保留。");
        onDataChanged?.();
      }else{
        const removed=await invoke<number>("zhidao_player_clear_web_profile");
        setMessage("已清除 "+removed+" 个官方网页登录数据文件。");
      }
      setAction("none");
    }catch(error){
      const text=friendlyBridgeError(error);
      setMessage(error instanceof Error&&error.message.includes("PLAYER_RUNNING")
        ?"请先关闭官方 WebView2 播放窗口，再清除网页登录数据。":text);
    }finally{setBusy(false);}
  }

  async function diagnose(){
    setBusy(true);setMessage("正在分别检查本机登录凭据、服务器会话和两类课程读取接口。");
    try{
      const result=await request<ZhidaoDiagnostic>({operation:"zhidao.diagnose"});
      setDiagnostic(result);
      const label=result.state==="confirmed"?"服务器会话与课程接口均已确认":
        result.state==="partial"?"服务器会话已确认，但部分课程接口异常":
        result.state==="no_credentials"?"尚未找到本机登录凭据":
        result.state==="invalid_credentials"?"本机登录凭据格式无效":
        result.state==="session_unconfirmed"?"服务器登录尚未确认":
        result.state==="server_unconfirmed"?"课程读取接口尚未确认":"诊断未完成";
      setMessage(label+"（诊断码 "+result.code+"）");
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(false);}
  }

  async function openFolder(){
    try{await invoke("zhidao_open_data_folder");}
    catch(error){setMessage(friendlyBridgeError(error));}
  }

  async function openDocument(id:"terms"|"privacy"|"license"|"source"){
    setDocumentBusy(true);setMessage("");
    try{setDocument(await request<ZhidaoDocument>({operation:"zhidao.document.read",document_id:id}));}
    catch(error){setMessage(friendlyBridgeError(error));}
    finally{setDocumentBusy(false);}
  }

  const selected=action==="none"?null:details[action];
  return <>
    <section className="settings-card sf-zhidao-account-tools">
      <div className="section-head"><h3><KeyRound size={17}/> 知到账号与本地数据</h3></div>
      <div className="sf-zd-account-actions">
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={()=>void diagnose()}>
          <ShieldCheck size={15}/>连接诊断
        </button>
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={()=>void openFolder()}>
          <FolderOpen size={15}/>打开数据目录
        </button>
        <button className="secondary" type="button" disabled={!desktop||busy}
          onClick={()=>void invoke("zhidao_open_official_site")}>
          <ExternalLink size={15}/>打开知到官网
        </button>
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={()=>setAction("session")}>
          <KeyRound size={15}/>退出登录
        </button>
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={()=>setAction("cache")}>
          <Trash2 size={15}/>清理课程缓存
        </button>
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={()=>setAction("web")}>
          <Database size={15}/>清除网页登录数据
        </button>
      </div>
      <div className="sf-zd-legal-actions">
        {docs.map(item=><button key={item.id} type="button" className="text-button"
          disabled={!desktop||documentBusy} onClick={()=>void openDocument(item.id)}>
          <item.icon size={14}/>{item.label}
        </button>)}
      </div>
      {diagnostic&&<div className="sf-zd-diagnostic">
        <strong>最近一次连接诊断</strong>
        {diagnostic.lines.length>0
          ?<ul>{diagnostic.lines.map((line,index)=><li key={index}>{line}</li>)}</ul>
          :<small>诊断没有返回可展示的服务器状态信息。</small>}
      </div>}
      {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
      <p className="sf-zd-progress-note">登录凭据、课程缓存和官方 WebView2 网页会话分开管理。所有清理操作只处理对应的明确文件或目录，不执行整目录删除。</p>
    </section>
    {selected&&<ConfirmDialog open={true} dark={dark} danger busy={busy}
      title={selected.title} description={selected.description} warning={selected.warning}
      confirmLabel="确认清理" cancelLabel="保留数据"
      onConfirm={()=>void runAction()} onCancel={()=>setAction("none")}/>}
    {document&&<div className="sf-document-overlay" role="presentation" onMouseDown={event=>{
      if(event.target===event.currentTarget)setDocument(null);
    }}>
      <section className="sf-document-dialog" role="dialog" aria-modal="true"
        aria-label={document.title}>
        <header><h3>{document.title}</h3>
          <button className="secondary" type="button" onClick={()=>setDocument(null)}>关闭</button>
        </header>
        <div className="sf-document-body"><pre>{document.content}</pre></div>
      </section>
    </div>}
  </>;
}
