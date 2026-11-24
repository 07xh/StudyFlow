import {useEffect,useRef,useState} from "react";
import type {Course} from "../types";
import {friendlyBridgeError,request,type XuexitongSettings,type XuexitongTaskItem} from "../bridge";
import {
  chapterOverview,filterXuexitongChapters,filterXuexitongTasks,
  type XuexitongChapter,type ChapterFilter,type TaskFilter,type CompletionFilter
} from "../xuexitongCatalog";
import "./XuexitongPanels.css";

type Chapter = XuexitongChapter;
const initialSettings:XuexitongSettings={
  playback_speed:1,concurrency:2,skip_completed:true,verify_after_run:true
};
const taskLabels:Record<string,string>={
  video:"视频",audio:"音频",document:"文档",workid:"章节测验",
  read:"阅读",live:"直播",flash:"交互课件"
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
      const confirmed=await request<XuexitongSettings>({operation:"xuexitong.settings.get"});
      if(JSON.stringify(confirmed)!==JSON.stringify(saved))throw new Error("XUEXITONG_SETTINGS_VERIFY_FAILED");
      setSettings(confirmed);
      setNotice("参数预设已保存在本机，后续课程任务会读取这些默认参数。");
    }catch(error){setNotice(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };
  return <section className="sf-platform-settings-view" aria-label="学习通参数预设">
    <p className="sf-muted">保存本机任务参数预设；课程工作台启动任务时也会同步保存速度与并发。</p>
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
  const [loading,setLoading]=useState(desktop);
  const [message,setMessage]=useState("");
  const [chapterError,setChapterError]=useState("");
  const [revision,setRevision]=useState(0);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [taskLoading,setTaskLoading]=useState(false);
  const [tasks,setTasks]=useState<XuexitongTaskItem[]>([]);
  const [taskError,setTaskError]=useState("");
  const [chapterSearch,setChapterSearch]=useState("");
  const [chapterFilter,setChapterFilter]=useState<ChapterFilter>("all");
  const [taskSearch,setTaskSearch]=useState("");
  const [taskFilter,setTaskFilter]=useState<TaskFilter>("all");
  const [taskCompletion,setTaskCompletion]=useState<CompletionFilter>("all");
  const taskCache=useRef(new Map<string,{items:XuexitongTaskItem[];readAt:number}>());
  useEffect(()=>{
    taskCache.current.clear();
    setChapterSearch("");
    setChapterFilter("all");
  },[course.course_id]);

  const overview=chapterOverview(chapters);
  const visibleChapters=filterXuexitongChapters(chapters,chapterSearch,chapterFilter);
  const visibleTasks=filterXuexitongTasks(tasks,taskSearch,taskFilter,taskCompletion);

  useEffect(()=>{
    if(!desktop){setLoading(false);return;}
    let live=true;
    setLoading(true);setMessage("");setChapterError("");
    setChapters([]);
    taskCache.current.clear();
    setExpanded(null);setTasks([]);setTaskError("");
    void request<Chapter[]>({operation:"xuexitong.chapters.list",course_id:course.course_id})
      .then(list=>{
        if(!live)return;
        if(!Array.isArray(list))throw Error("INVALID_IPC_RESPONSE");
        setChapters(list);
        if(!list.length)setMessage("当前课程未返回可读取的章节。");
      }).catch(error=>{if(live)setChapterError(friendlyBridgeError(error));})
      .finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[desktop,course.course_id,revision]);

  useEffect(()=>{
    if(!desktop||expanded===null){setTaskLoading(false);return;}
    let live=true;
    const key=course.course_id+":"+expanded;
    const cached=taskCache.current.get(key);
    setTaskError("");
    if(cached&&Date.now()-cached.readAt<120000){
      setTasks(cached.items);setTaskLoading(false);
      return;
    }
    setTasks([]);setTaskLoading(true);
    void request<XuexitongTaskItem[]>({
      operation:"xuexitong.chapter.tasks",course_id:course.course_id,chapter_id:expanded
    }).then(items=>{
      if(!live)return;
      if(!Array.isArray(items))throw Error("INVALID_IPC_RESPONSE");
      taskCache.current.set(key,{items,readAt:Date.now()});
      setTasks(items);
    }).catch(error=>{if(live)setTaskError(friendlyBridgeError(error));})
      .finally(()=>{if(live)setTaskLoading(false);});
    return ()=>{live=false;};
  },[desktop,course.course_id,expanded,revision]);

  return <section aria-label="学习通章节与任务点" className="sf-xxt-catalog">
    <div className="section-head sf-xxt-heading">
      <div>
        <h3>章节与任务点</h3>
        <p className="sf-muted">
          {loading?"正在读取章节…":chapterError?"章节读取失败":!desktop?"请在 Windows 桌面版读取":`显示 ${visibleChapters.length} / ${overview.total} 个章节 · 标记完成 ${overview.completed} · 待学习 ${overview.pending} · 未解锁 ${overview.locked}`}
        </p>
      </div>
      <button type="button" className="secondary" disabled={!desktop||loading}
        onClick={()=>{setLoading(true);setExpanded(null);setTasks([]);setTaskError("");setChapterError("");taskCache.current.clear();setRevision(value=>value+1);}}>{loading?"读取中…":"刷新章节"}</button>
    </div>
    <div className="sf-xxt-filters" role="group" aria-label="章节筛选">
      <label className="sf-xxt-search"><span>搜索章节</span>
        <input type="search" value={chapterSearch} placeholder="章节名称或 ID"
          onChange={event=>setChapterSearch(event.target.value)}/>
      </label>
      <label className="sf-xxt-select"><span>章节状态</span>
        <select value={chapterFilter} onChange={event=>setChapterFilter(event.target.value as ChapterFilter)}>
          <option value="all">全部章节</option>
          <option value="pending">待学习</option>
          <option value="completed">已标记完成</option>
          <option value="locked">未解锁</option>
        </select>
      </label>
    </div>
    {loading&&<p role="status" className="sf-muted">正在读取真实章节…</p>}
    {chapterError&&<p role="alert">{chapterError}</p>}
    {!desktop&&<p role="status" className="sf-muted">请在 Windows 桌面版读取真实章节。</p>}
    {!loading&&!chapterError&&message&&<p role="status" className="sf-muted">{message}</p>}
    {!loading&&chapters.length>0&&visibleChapters.length===0&&
      <p className="sf-muted" role="status">没有符合当前筛选条件的章节。</p>}
    <div className="sf-xxt-chapters">
      {visibleChapters.map(item=><article key={item.id} className="sf-xxt-chapter">
        <div className="sf-xxt-chapter-head">
          <div className="sf-xxt-chapter-title">
            <strong title={item.title+" · ID: "+item.id}>{item.title}</strong>
          </div>
          <span className={"sf-xxt-state "+(item.locked?"locked":item.completed?"completed":"pending")}>
            {item.locked?"未解锁":item.completed?"已标记完成":"待学习"}
          </span>
          <button type="button" className="secondary" disabled={!desktop||loading||item.locked}
            aria-expanded={expanded===item.id} aria-label={item.title+"："+(expanded===item.id?"收起任务点":"查看任务点")}
            onClick={()=>{
              const next=expanded===item.id?null:item.id;
              setTasks([]);setTaskError("");setTaskLoading(next!==null);setExpanded(next);
              setTaskSearch("");setTaskFilter("all");setTaskCompletion("all");
            }}>
            {expanded===item.id?"收起":"查看任务点"}
          </button>
        </div>
        {expanded===item.id&&<div className="sf-xxt-task-panel" aria-label={item.title+"的任务点"}>
          <div className="sf-xxt-filters sf-xxt-task-filters" role="group" aria-label="任务点筛选">
            <label className="sf-xxt-search"><span>搜索任务</span>
              <input type="search" value={taskSearch} placeholder="任务名称"
                onChange={event=>setTaskSearch(event.target.value)}/>
            </label>
            <label className="sf-xxt-select"><span>任务类型</span>
              <select value={taskFilter} onChange={event=>setTaskFilter(event.target.value as TaskFilter)}>
                <option value="all">全部类型</option><option value="video">视频</option>
                <option value="audio">音频</option><option value="document">文档</option>
                <option value="read">阅读</option><option value="workid">测验</option>
                <option value="live">直播</option><option value="flash">交互课件</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className="sf-xxt-select"><span>任务状态</span>
              <select value={taskCompletion} onChange={event=>setTaskCompletion(event.target.value as CompletionFilter)}>
                <option value="all">全部状态</option><option value="pending">未完成</option>
                <option value="completed">已标记完成</option><option value="unknown">待核验</option>
              </select>
            </label>
          </div>
          {taskLoading&&<p role="status" className="sf-muted">读取本章节任务点…</p>}
          {taskError&&<p role="alert">{taskError}</p>}
          {!taskLoading&&!taskError&&
            <p className="sf-xxt-task-summary">{visibleTasks.length}/{tasks.length} 项任务
              {tasks.length>0?" · 已标记完成 "+tasks.filter(task=>task.completed===true).length+" 项 · 待核验 "+tasks.filter(task=>task.completed===null).length+" 项":""}
            </p>}
          {!taskLoading&&!taskError&&visibleTasks.length===0&&
            <p className="sf-muted" role="status">
              {tasks.length===0?"本章节未返回可识别的任务点。":"没有符合筛选条件的任务。"}
            </p>}
          <ul className="sf-xxt-task-list">
            {!taskLoading&&!taskError&&visibleTasks.map(task=><li key={task.id} className="sf-xxt-task-item">
              <span className="sf-xxt-task-type">{taskLabels[task.type]??"其他任务"}</span>
              <strong title={task.title}>{task.title}</strong>
              <span className={"sf-xxt-state "+(task.completed===true?"completed":task.completed===false?"pending":"unknown")}>
                {task.completed===true?"已标记完成":task.completed===false?"未完成":"待核验"}
              </span>
            </li>)}
          </ul>
        </div>}
      </article>)}
    </div>
    <details className="sf-technical-note"><summary>数据口径</summary><p className="sf-muted sf-xxt-evidence-note">章节与任务状态来自学习通页面返回的标记，不等于官方课程总进度。</p></details>
  </section>;
}
