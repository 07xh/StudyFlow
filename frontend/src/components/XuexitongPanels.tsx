import {useEffect,useState} from "react";
import type {Course} from "../types";
import {friendlyBridgeError,request} from "../bridge";

type Chapter = {id:string;title:string;completed:boolean;locked:boolean};

export function XuexitongLoginPanel({desktop,onConnected}:{
  desktop:boolean;onConnected:()=>void;
}){
  const [cookie,setCookie]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const save=async()=>{
    if(!cookie.trim()||busy||!desktop)return;
    setBusy(true);setMessage("");
    try{
      await request<{saved:boolean}>({operation:"xuexitong.session.configure",cookie:cookie.trim()});
      setCookie("");
      setMessage("登录会话已保存到 Windows 凭据管理器，正在核验课程连接。");
      onConnected();
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  const clear=async()=>{
    if(busy||!desktop)return;
    setBusy(true);setMessage("");
    try{
      await request<{cleared:boolean}>({operation:"xuexitong.session.clear"});
      setCookie("");setMessage("已清除学序保存的学习通会话。");onConnected();
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  return <div className="sf-platform-settings-view" aria-label="学习通账号与连接">
    <p className="sf-muted">将本人学习通登录会话安全保存到 Windows 凭据管理器。此处不会把 Cookie 保存到浏览器本地存储。</p>
    <label htmlFor="xuexitong-session-cookie">学习通 Cookie</label>
    <input id="xuexitong-session-cookie" type="password" autoComplete="off" spellCheck={false}
      placeholder="粘贴当前有效的学习通 Cookie" value={cookie}
      onChange={event=>setCookie(event.target.value)} disabled={!desktop||busy}/>
    <div className="actions">
      <button type="button" disabled={!desktop||busy||!cookie.trim()} onClick={()=>void save()}>
        {busy?"处理中…":"保存登录会话"}
      </button>
      <button type="button" className="secondary" disabled={!desktop||busy} onClick={()=>void clear()}>
        退出并清除
      </button>
    </div>
    {message&&<p role="status">{message}</p>}
  </div>;
}

export function XuexitongCourseDetailPanel({course,desktop}:{
  course:Course;desktop:boolean;
}){
  const [chapters,setChapters]=useState<Chapter[]>([]);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("");
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!desktop)return;
    let live=true;
    setLoading(true);setMessage("");
    setChapters([]);
    void request<Chapter[]>({operation:"xuexitong.chapters.list",course_id:course.course_id})
      .then(list=>{
        if(!live)return;
        if(!Array.isArray(list))throw Error("INVALID_IPC_RESPONSE");
        setChapters(list);
        if(!list.length)setMessage("当前课程未返回可读取的章节。");
      }).catch(error=>{if(live)setMessage(friendlyBridgeError(error));})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[desktop,course.course_id,revision]);
  return <section aria-label="学习通章节目录">
    <div className="section-head">
      <h3>课程章节</h3>
      <button type="button" className="secondary" disabled={!desktop||loading}
        onClick={()=>setRevision(value=>value+1)}>刷新章节</button>
    </div>
    {loading&&<p role="status" className="sf-muted">正在读取学习通真实章节…</p>}
    {message&&<p role="status" className="sf-muted">{message}</p>}
    <div className="sf-recent-list">
      {chapters.map(item=><article key={item.id} className="sf-recent-row">
        <div className="sf-recent-main">
          <strong title={item.title}>{item.title}</strong>
          <p className="sf-muted">{item.locked?"未解锁":item.completed?"已标记完成":"待学习"} · 章节 {item.id}</p>
        </div>
      </article>)}
    </div>
  </section>;
}
