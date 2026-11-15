import {useCallback,useEffect,useId,useMemo,useRef,useState} from "react";
import {ChevronDown,ChevronRight,RefreshCw} from "lucide-react";
import {friendlyBridgeError,request,type YuketangCourseProgress,
  type YuketangVideoProgress} from "../bridge";
import type {Course} from "../types";

type Props={course:Course;desktop:boolean;connected:boolean;scopeDirty:boolean};
type LoadState="idle"|"loading"|"ready"|"blocked"|"error";
type ProgressFilter="all"|"pending"|"done"|"unknown";
const PAGE_SIZE=8;

function duration(value:number|null){
  if(value===null||!Number.isFinite(value)||value<0)return "—";
  const seconds=Math.floor(value);
  return String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
}

function validPage(data:YuketangCourseProgress,courseId:string,offset:number){
  if(!data||data.course_id!==courseId||data.offset!==offset||
     !Number.isInteger(data.total)||data.total<0||
     (data.next_offset!==null&&(!Number.isInteger(data.next_offset)||
      data.next_offset<=offset||data.next_offset>data.total))||
     !Array.isArray(data.items)||data.items.length>PAGE_SIZE)return false;
  if(offset+data.items.length>data.total||
     (data.next_offset!==null&&data.next_offset!==offset+data.items.length)||
     (data.next_offset===null&&offset+data.items.length<data.total))return false;
  return data.items.every(item=>
    item&&typeof item.id==="string"&&item.id.length>0&&
    typeof item.name==="string"&&typeof item.chapter==="string"&&
    (item.progress_percent===null||typeof item.progress_percent==="number"&&
      Number.isFinite(item.progress_percent)&&item.progress_percent>=0&&item.progress_percent<=100)&&
    (item.verified_at===null||typeof item.verified_at==="string")&&
    (item.server_completed===null||typeof item.server_completed==="boolean")&&
    (item.progress_percent===null?item.server_completed===null:typeof item.server_completed==="boolean")&&
    (item.progress_percent===null||item.verified_at!==null)
  );
}

/** Current classroom only: real chapter/video list and independent read-only server verification. */
export function YuketangCourseDetailPanel({course,desktop,connected,scopeDirty}:Props){
  const [videos,setVideos]=useState<YuketangVideoProgress[]>([]);
  const [total,setTotal]=useState(0);
  const [nextOffset,setNextOffset]=useState<number|null>(null);
  const [state,setState]=useState<LoadState>("idle");
  const [message,setMessage]=useState("");
  const revision=useRef(0);
  const [filter,setFilter]=useState<ProgressFilter>("all");
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const panelId=useId();

  const load=useCallback(async(offset:number,reset:boolean)=>{
    const current=++revision.current;
    if(reset){setVideos([]);setTotal(0);setNextOffset(null);}
    setMessage("");
    if(!desktop){
      setState("blocked");setMessage("请使用学序 Windows 桌面版读取真实课堂进度。");return;
    }
    if(scopeDirty){
      setState("blocked");setMessage("课堂范围尚未保存，请先保存课堂范围，再同步课程列表。");return;
    }
    if(!connected){
      setState("blocked");setMessage("雨课堂会话未确认，请检查登录状态。");return;
    }
    setState("loading");
    try{
      const result=await request<YuketangCourseProgress>({
        operation:"yuketang.course.detail",course_id:course.course_id,
        offset,limit:PAGE_SIZE
      });
      if(current!==revision.current)return;
      if(!validPage(result,course.course_id,offset))throw new Error("INVALID_IPC_RESPONSE");
      setVideos(previous=>reset?result.items:[...previous,...result.items]);
      setTotal(result.total);setNextOffset(result.next_offset);setState("ready");
    }catch(error){
      if(current!==revision.current)return;
      setState("error");setMessage(friendlyBridgeError(error));
    }
  },[course.course_id,desktop,connected,scopeDirty]);

  useEffect(()=>{void load(0,true);return()=>{revision.current++;};},[load]);

  useEffect(()=>{
    setFilter("all");
    setExpanded({});
  },[course.course_id]);

  const chapters=useMemo(()=>{
    const groups=new Map<string,YuketangVideoProgress[]>();
    for(const video of videos){
      const chapter=video.chapter.trim()||"未命名章节";
      if(!groups.has(chapter))groups.set(chapter,[]);
      groups.get(chapter)!.push(video);
    }
    return [...groups.entries()];
  },[videos]);
  const verified=videos.filter(video=>video.progress_percent!==null);
  const completed=verified.filter(video=>video.server_completed===true).length;
  const pending=verified.length-completed;
  const unknown=videos.length-verified.length;
  const filters:{id:ProgressFilter;label:string;count:number}[]=[
    {id:"all",label:"全部",count:videos.length},
    {id:"pending",label:"待完成",count:pending},
    {id:"done",label:"已完成",count:completed},
    {id:"unknown",label:"未核验",count:unknown},
  ];
  // Filtering is local to the fetched page(s); it never claims a whole-course status.
  const visibleChapters=useMemo(()=>chapters.map(([chapter,items])=>[
    chapter,items.filter(video=>filter==="all"||
      (filter==="unknown"&&video.progress_percent===null)||
      (filter==="done"&&video.server_completed===true)||
      (filter==="pending"&&video.progress_percent!==null&&video.server_completed===false))
  ] as [string,YuketangVideoProgress[]]).filter(([,items])=>items.length>0),[chapters,filter]);
  const toggleAll=(open:boolean)=>{
    setExpanded(Object.fromEntries(chapters.map(([name])=>[name,open])));
  };

  return <section className="sf-ykt-course-chapters course-v2-detail sf-zhidao-course-detail"
    aria-label="雨课堂章节学习进度">
    <div className="sf-zd-detail-heading">
      <div>
        <span className="eyebrow">当前课堂 / 服务器只读记录</span>
        <h3>章节进度</h3>
        <p>仅展示已读取视频的服务器记录，未核验内容不推断完成状态。</p>
      </div>
      <button type="button" className="secondary"
        disabled={!desktop||!connected||scopeDirty||state==="loading"}
        onClick={()=>void load(0,true)}>
        <RefreshCw size={14}/>{state==="loading"?"核验中…":"刷新进度"}
      </button>
    </div>
    {videos.length>0&&<div className="sf-zd-detail-summary sf-ykt-progress-summary">
      <div><span>已读取视频</span><strong>{videos.length} / {total}</strong></div>
      <div><span>服务器已核验</span><strong>{verified.length} / {videos.length}</strong></div>
      <div><span>已确认完成</span><strong>{completed} 节</strong></div>
    </div>}
    {state==="loading"&&<p role="status">正在从当前课堂逐节读取服务器进度…</p>}
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    {videos.length>0&&<div className="sf-ykt-progress-toolbar">
      <div className="sf-ykt-progress-filters" role="group" aria-label="筛选已读取视频的进度">
        {filters.map(option=><button key={option.id} type="button"
          className={filter===option.id?"active":""}
          aria-pressed={filter===option.id} onClick={()=>setFilter(option.id)}>
          {option.label} <span>{option.count}</span>
        </button>)}
      </div>
      <div className="sf-ykt-expand-actions">
        <button className="secondary" type="button" onClick={()=>toggleAll(true)}>展开全部</button>
        <button className="secondary" type="button" onClick={()=>toggleAll(false)}>收起全部</button>
      </div>
    </div>}
    {(state==="ready"||videos.length>0)&&<div className="sf-ykt-videos">
      {videos.length===0
        ?<p className="sf-muted">当前课堂没有可识别的视频章节，或课程尚未发布视频。</p>
        :visibleChapters.length===0
          ?<p className="sf-muted">当前已读取的视频没有符合筛选条件的记录。可切换筛选，或继续核验后续视频。</p>
          :visibleChapters.map(([chapter,items],index)=>{
            const allItems=chapters.find(([name])=>name===chapter)?.[1]??items;
            const count=allItems.filter(item=>item.progress_percent!==null).length;
            const done=allItems.filter(item=>item.server_completed===true).length;
            const isExpanded=expanded[chapter]??index===0;
            return <div className="sf-ykt-chapter-group" key={chapter}>
              <button type="button" className="sf-ykt-chapter-toggle"
                aria-expanded={isExpanded} aria-controls={panelId+"-chapter-"+index}
                onClick={()=>setExpanded(previous=>({...previous,[chapter]:!isExpanded}))}>
                <span className="sf-ykt-chapter-name">
                  {isExpanded?<ChevronDown size={16}/>:<ChevronRight size={16}/>}
                  <strong>{chapter}</strong>
                </span>
                <span className="sf-ykt-chapter-stats">
                  已读取 {allItems.length} 节 · 核验 {count} 节 · 完成 {done} 节
                </span>
              </button>
              {isExpanded&&<div className="sf-zd-detail-list sf-zd-detail-list-expanded"
                id={panelId+"-chapter-"+index}>
                {items.map(video=><article className="sf-zd-detail-item" key={video.id}>
                  <div className="sf-zd-detail-item-head">
                    <strong>{video.name}</strong>
                    <span>{video.progress_percent===null?"未核验":
                      video.progress_percent.toFixed(1)+"%"}</span>
                  </div>
                  <small>{video.progress_percent===null
                    ?"服务器未返回可确认的进度"
                    :video.server_completed?"服务器已确认完成":"服务器已核验 · 尚未完成"}
                    {video.last_point_seconds!==null&&
                      " · 最后位置 "+duration(video.last_point_seconds)}
                    {video.duration_seconds!==null&&
                      " / 总时长 "+duration(video.duration_seconds)}
                  </small>
                  {video.progress_percent!==null&&
                    <div className="sf-zd-detail-track" role="progressbar"
                      aria-label={video.name+"服务器进度"}
                      aria-valuemin={0} aria-valuemax={100} aria-valuenow={video.progress_percent}>
                      <span style={{width:video.progress_percent+"%"}}/>
                    </div>}
                </article>)}
              </div>}
            </div>;
          })}
    </div>}
    {nextOffset!==null&&<div className="actions sf-ykt-page-actions">
      <button type="button" className="secondary"
        disabled={state==="loading"||!connected||scopeDirty}
        onClick={()=>void load(nextOffset,false)}>
        {state==="loading"?"核验中…":
          "继续核验后续视频（剩余 "+Math.max(0,total-videos.length)+" 节）"}
      </button>
    </div>}
    <details className="sf-technical-note">
      <summary>进度口径</summary>
      <p className="sf-muted">一次最多核验 {PAGE_SIZE} 节视频，统计仅涵盖已读取记录。
        未核验不等于 0%，本地播放位置和任务日志不等于服务器学习进度。</p>
    </details>
  </section>;
}
