import {useCallback,useEffect,useId,useMemo,useState,useSyncExternalStore} from "react";
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

/** Genuine read-only progress survives page unmounts, for this app session only. */
type Access={desktop:boolean;connected:boolean;scopeDirty:boolean};
type ProgressSnapshot={
  videos:YuketangVideoProgress[];total:number;nextOffset:number|null;
  state:LoadState;message:string;checkedAt:number|null;
  scanningCount:number;scanningTotal:number|null;resumeOffset:number|null;
};
type PendingBatch={videos:YuketangVideoProgress[];total:number|null;cursor:number};
type Entry={
  snapshot:ProgressSnapshot;listeners:Set<()=>void>;revision:number;
  inFlight:Promise<void>|null;lastAttempt:number;pending:PendingBatch|null;
};
const AUTO_REFRESH_MS=120_000;
const RETRY_COOLDOWN_MS=60_000;
const entries=new Map<string,Entry>();
const emptySnapshot=():ProgressSnapshot=>({
  videos:[],total:0,nextOffset:null,state:"idle",message:"",
  checkedAt:null,scanningCount:0,scanningTotal:null,resumeOffset:null
});
function getEntry(courseId:string):Entry{
  let entry=entries.get(courseId);
  if(!entry){
    entry={snapshot:emptySnapshot(),listeners:new Set(),revision:0,
      inFlight:null,lastAttempt:0,pending:null};
    entries.set(courseId,entry);
  }
  return entry;
}
function publish(entry:Entry,next:ProgressSnapshot){
  entry.snapshot=next;
  for(const notify of entry.listeners)notify();
}

/** Sign-out/scope changes invalidate both cached evidence and in-flight replies. */
export function resetYuketangVerification(){
  for(const entry of entries.values()){
    entry.revision++;
    entry.inFlight=null;
    entry.lastAttempt=0;
    entry.pending=null;
    publish(entry,emptySnapshot());
  }
}

/** App-level timer and panel share a single bounded sequential request stream. */
export function verifyYuketangCourse(
  courseId:string,access:Access,options:{force?:boolean;resume?:boolean}={}
):Promise<void>{
  if(!courseId||!access.desktop||!access.connected||access.scopeDirty)return Promise.resolve();
  const entry=getEntry(courseId);
  if(entry.inFlight)return entry.inFlight;
  const now=Date.now();
  if(!options.force){
    if(entry.lastAttempt!==0&&now-entry.lastAttempt<RETRY_COOLDOWN_MS)return Promise.resolve();
    if(entry.snapshot.checkedAt!==null&&now-entry.snapshot.checkedAt<AUTO_REFRESH_MS)return Promise.resolve();
  }
  entry.lastAttempt=now;
  const revision=++entry.revision;
  const hadComplete=entry.snapshot.checkedAt!==null&&entry.snapshot.nextOffset===null;
  const resuming=(options.resume??entry.snapshot.state==="error")&&entry.pending!==null;
  const initial:PendingBatch=resuming
    ?{videos:[...entry.pending!.videos],total:entry.pending!.total,cursor:entry.pending!.cursor}
    :{videos:[],total:null,cursor:0};
  entry.pending=null;
  publish(entry,{...entry.snapshot,state:"loading",message:"",
    scanningCount:initial.videos.length,scanningTotal:initial.total,resumeOffset:null});
  const run=async()=>{
    let working=initial.videos;
    let cursor=initial.cursor;
    let expectedTotal=initial.total;
    try{
      while(true){
        const pageOffset=cursor;
        const result=await request<YuketangCourseProgress>({
          operation:"yuketang.course.detail",course_id:courseId,
          offset:pageOffset,limit:PAGE_SIZE
        });
        if(entry.revision!==revision)return;
        if(!validPage(result,courseId,pageOffset)||
           (expectedTotal!==null&&result.total!==expectedTotal)||
           (result.next_offset!==null&&result.items.length===0))
          throw new Error("INVALID_IPC_RESPONSE");
        expectedTotal=result.total;
        working=[...working,...result.items];
        cursor=result.next_offset??result.total;
        if(result.next_offset===null){
          entry.pending=null;
          publish(entry,{
            videos:working,total:result.total,nextOffset:null,
            state:"ready",message:"",checkedAt:Date.now(),
            scanningCount:0,scanningTotal:null,resumeOffset:null
          });
          return;
        }
        // During a later recheck, leave the complete previous evidence visible.
        // The first scan can display only the successfully verified pages.
        publish(entry,{
          ...(hadComplete?entry.snapshot:{
            ...entry.snapshot,videos:working,total:result.total,nextOffset:result.next_offset
          }),
          state:"loading",message:"",scanningCount:working.length,
          scanningTotal:result.total,resumeOffset:null
        });
      }
    }catch(error){
      if(entry.revision!==revision)return;
      const invalid=error instanceof Error&&error.message==="INVALID_IPC_RESPONSE";
      entry.pending=!invalid&&working.length>0?
        {videos:working,total:expectedTotal,cursor}:null;
      const reason=friendlyBridgeError(error);
      publish(entry,{
        ...entry.snapshot,
        ...(!hadComplete&&working.length>0?{
          videos:working,total:expectedTotal??working.length,nextOffset:cursor
        }:{}),
        state:"error",
        message:hadComplete
          ?"后台复核失败，继续显示上次真实服务器核验结果："+reason
          :working.length>0
            ?"部分视频已读取并保留真实服务器记录；后续批次失败："+reason+"。可从中断位置继续核验。"
            :reason,
        scanningCount:0,scanningTotal:null,
        resumeOffset:entry.pending?.cursor??null
      });
    }
  };
  const running=run();
  entry.inFlight=running;
  void running.finally(()=>{if(entry.inFlight===running)entry.inFlight=null;});
  return running;
}

/** Current classroom only: shared read-only state across navigation. */
export function YuketangCourseDetailPanel({course,desktop,connected,scopeDirty,
  autoVerifyEnabled=true,onAutoVerifyChange}:Props&{
    autoVerifyEnabled?:boolean;onAutoVerifyChange?:(enabled:boolean)=>void
  }){
  const entry=getEntry(course.course_id);
  const subscribe=useCallback((notify:()=>void)=>{
    entry.listeners.add(notify);
    return ()=>{entry.listeners.delete(notify);};
  },[entry]);
  const cached=useSyncExternalStore(subscribe,()=>entry.snapshot,()=>entry.snapshot);
  const blockedMessage=!desktop?"请使用学序 Windows 桌面版读取真实课堂进度。"
    :scopeDirty?"课堂范围尚未保存，请先保存课堂范围，再同步课程列表。"
    :!connected?"雨课堂会话未确认，请检查登录状态。":"";
  const {videos,total,nextOffset,state,message,checkedAt,scanningCount,scanningTotal,resumeOffset}=
    blockedMessage?{...emptySnapshot(),state:"blocked" as LoadState,message:blockedMessage}:cached;
  const access={desktop,connected,scopeDirty};
  const [filter,setFilter]=useState<ProgressFilter>("all");
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const panelId=useId();

  // Returning to a fresh snapshot does not request the same pages again.
  // App owns background polling, so unmounting this view never stops it.
  useEffect(()=>{
    if(autoVerifyEnabled)void verifyYuketangCourse(course.course_id,{desktop,connected,scopeDirty});
  },[course.course_id,desktop,connected,scopeDirty,autoVerifyEnabled]);
  useEffect(()=>{setFilter("all");setExpanded({});},[course.course_id]);
  const refresh=()=>void verifyYuketangCourse(course.course_id,access,{force:true});
  const resume=()=>void verifyYuketangCourse(course.course_id,access,{force:true,resume:true});

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
        <p>自动逐批读取全部视频的真实服务器进度；未核验内容不推断完成状态。</p>
      </div>
      <div className="sf-ykt-verify-actions"><label className="sf-ykt-auto-verify"><input type="checkbox"
        checked={autoVerifyEnabled} disabled={!desktop||!connected||scopeDirty||!onAutoVerifyChange}
        onChange={event=>onAutoVerifyChange?.(event.currentTarget.checked)}/>
        后续自动核验（约每 2 分钟）</label>
      <button type="button" className="secondary"
        disabled={!desktop||!connected||scopeDirty||state==="loading"}
        onClick={refresh}>
        <RefreshCw size={14}/>{state==="loading"?"核验全课中…":"重新核验全课"}
      </button></div>
    </div>
    {checkedAt!==null&&!blockedMessage&&<p className="sf-ykt-scan-state" role="status">上次完整服务器核验：{new Date(checkedAt).toLocaleString()}。返回课程不会重复全量读取。</p>}
    {videos.length>0&&<div className="sf-zd-detail-summary sf-ykt-progress-summary">
      <div><span>已读取视频</span><strong>{videos.length} / {total}</strong></div>
      <div><span>服务器已核验</span><strong>{verified.length} / {videos.length}</strong></div>
      <div><span>已确认完成</span><strong>{completed} 节</strong></div>
    </div>}
    {state==="loading"&&<p className="sf-ykt-scan-state" role="status" aria-live="polite">
      正在自动核验全课：本轮已读取 {scanningCount} / {scanningTotal??"…"} 节视频，按批次连续读取。
    </p>}
    {state==="ready"&&videos.length>0&&<p className="sf-ykt-scan-state" role="status">
      已读取 {videos.length} / {total} 节；{unknown>0?unknown+" 节尚无服务器确认记录。":"全部视频均有可确认的服务器进度。"}
    </p>}
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
    {(nextOffset!==null||resumeOffset!==null)&&state==="error"&&<div className="actions sf-ykt-page-actions">
      <button type="button" className="secondary"
        disabled={!connected||scopeDirty}
        onClick={resume}>
        {"继续核验剩余视频（剩余 "+Math.max(0,total-videos.length)+" 节）"}
      </button>
    </div>}
    <details className="sf-technical-note">
      <summary>进度口径</summary>
      <p className="sf-muted">单批最多核验 {PAGE_SIZE} 节视频，程序会自动核验完整课堂；中途失败可继续。统计仅涵盖已经收到的真实记录。
        未核验不等于 0%，本地播放位置和任务日志不等于服务器学习进度。</p>
    </details>
  </section>;
}
