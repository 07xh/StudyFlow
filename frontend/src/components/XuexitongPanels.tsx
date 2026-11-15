import {useEffect,useState} from "react";
import type {Course} from "../types";
import {friendlyBridgeError,request,type XuexitongSettings,type XuexitongTaskItem} from "../bridge";

type Chapter = {id:string;title:string;completed:boolean;locked:boolean};
const initialSettings:XuexitongSettings={
  playback_speed:1,concurrency:2,skip_completed:true,verify_after_run:true
};
const taskLabels:Record<string,string>={
  video:"视频",audio:"音频",document:"文档",workid:"章节测验",
  read:"阅读",live:"直播"
};

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
      setMessage("会话已安全保存。学序正在重新检测登录和课程状态。");
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
    <p className="sf-muted">登录会话使用 Windows 凭据管理器保存，不写入浏览器本地存储或操作日志。</p>
    <label htmlFor="xuexitong-session-cookie">学习通 Cookie</label>
    <input id="xuexitong-session-cookie" type="password" autoComplete="off" spellCheck={false}
      placeholder="粘贴本人当前有效的学习通 Cookie" value={cookie}
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

export function XuexitongSettingsPanel({desktop}:{
  desktop:boolean;
}){
  const [settings,setSettings]=useState<XuexitongSettings>(initialSettings);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    if(!desktop)return;
    let live=true;
    void request<XuexitongSettings>({operation:"xuexitong.settings.get"})
      .then(result=>{if(live){setSettings(result);setLoaded(true);}})
      .catch(error=>{if(live)setNotice(friendlyBridgeError(error));});
    return ()=>{live=false;};
  },[desktop]);

  const save=async()=>{
    if(!desktop||busy||!loaded)return;
    setBusy(true);setNotice("");
    try{
      const saved=await request<XuexitongSettings>({operation:"xuexitong.settings.save",settings});
      setSettings(saved);
      setNotice("参数预设已保存在本机。待你接入自己的执行模块后由适配器读取。");
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  return <section className="sf-platform-settings-view" aria-label="学习通参数预设">
    <p className="sf-muted">此处只保存独立运行器的参数预设。心跳执行模块由你自行接入，当前设置不会启动任何任务。</p>
    <div className="sf-settings-line">
      <label htmlFor="xxt-speed">播放速度预设</label>
      <select id="xxt-speed" disabled={!desktop||!loaded||busy}
        value={settings.playback_speed}
        onChange={e=>setSettings(previous=>({...previous,playback_speed:Number(e.target.value)}))}>
        <option value={1}>1×</option><option value={1.25}>1.25×</option>
        <option value={1.5}>1.5×</option><option value={2}>2×</option>
      </select>
    </div>
    <div className="sf-settings-line">
      <label htmlFor="xxt-concurrency">独立章节并发预设</label>
      <select id="xxt-concurrency" disabled={!desktop||!loaded||busy}
        value={settings.concurrency}
        onChange={e=>setSettings(previous=>({...previous,concurrency:Number(e.target.value)}))}>
        <option value={1}>1</option><option value={2}>2</option>
        <option value={3}>3</option><option value={4}>4</option>
      </select>
    </div>
    <label className="sf-settings-line">
      <span>跳过服务器确认已完成的任务</span>
      <input type="checkbox" disabled={!desktop||!loaded||busy}
        checked={settings.skip_completed}
        onChange={e=>setSettings(previous=>({...previous,skip_completed:e.target.checked}))}/>
    </label>
    <label className="sf-settings-line">
      <span>任务结束后核验</span>
      <input type="checkbox" disabled={!desktop||!loaded||busy}
        checked={settings.verify_after_run}
        onChange={e=>setSettings(previous=>({...previous,verify_after_run:e.target.checked}))}/>
    </label>
    <div className="actions">
      <button type="button" disabled={!desktop||!loaded||busy} onClick={()=>void save()}>
        {busy?"保存中…":"保存参数预设"}
      </button>
    </div>
    {notice&&<p role="status">{notice}</p>}
  </section>;
}

export function XuexitongCourseDetailPanel({course,desktop}:{
  course:Course;desktop:boolean;
}){
  const [chapters,setChapters]=useState<Chapter[]>([]);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("");
  const [revision,setRevision]=useState(0);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [taskLoading,setTaskLoading]=useState(false);
  const [tasks,setTasks]=useState<XuexitongTaskItem[]>([]);
  const [taskError,setTaskError]=useState("");

  useEffect(()=>{
    if(!desktop)return;
    let live=true;
    setLoading(true);setMessage("");
    setChapters([]);
    setExpanded(null);setTasks([]);setTaskError("");
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

  useEffect(()=>{
    if(!desktop||expanded===null)return;
    let live=true;
    setTasks([]);setTaskError("");setTaskLoading(true);
    void request<XuexitongTaskItem[]>({
      operation:"xuexitong.chapter.tasks",course_id:course.course_id,chapter_id:expanded
    }).then(items=>{
      if(!live)return;
      if(!Array.isArray(items))throw Error("INVALID_IPC_RESPONSE");
      setTasks(items);
    }).catch(error=>{if(live)setTaskError(friendlyBridgeError(error));})
      .finally(()=>{if(live)setTaskLoading(false);});
    return ()=>{live=false;};
  },[desktop,course.course_id,expanded,revision]);

  return <section aria-label="学习通章节与任务点">
    <div className="section-head">
      <h3>章节与任务点</h3>
      <button type="button" className="secondary" disabled={!desktop||loading}
        onClick={()=>setRevision(value=>value+1)}>刷新章节</button>
    </div>
    {loading&&<p role="status" className="sf-muted">正在读取真实章节…</p>}
    {message&&<p role="status" className="sf-muted">{message}</p>}
    <div className="sf-recent-list">
      {chapters.map(item=><article key={item.id} className="sf-recent-row">
        <div className="sf-recent-main">
          <strong title={item.title}>{item.title}</strong>
          <p className="sf-muted">{item.locked?"未解锁":item.completed?"已标记完成":"待学习"}</p>
          {expanded===item.id&&<div aria-label="本章节任务点">
            {taskLoading&&<p role="status" className="sf-muted">读取视频、文档及测验任务…</p>}
            {taskError&&<p role="alert">{taskError}</p>}
            {!taskLoading&&!taskError&&tasks.length===0&&<p className="sf-muted">本章节没有返回可识别的任务点。</p>}
            {!taskLoading&&tasks.map(task=><p key={task.id}>
              <strong>{taskLabels[task.type]??"其他任务"}</strong>
              {" · "}{task.title}{" · "}{task.completed?"已完成":"未完成"}
            </p>)}
          </div>}
        </div>
        <button className="secondary" type="button" disabled={!desktop||loading||item.locked}
          aria-expanded={expanded===item.id}
          onClick={()=>setExpanded(previous=>previous===item.id?null:item.id)}>
          {expanded===item.id?"收起":"查看任务点"}
        </button>
      </article>)}
    </div>
  </section>;
}
