import {useCallback,useEffect,useMemo,useState,useSyncExternalStore} from "react";
import {RefreshCw} from "lucide-react";
import {friendlyBridgeError,request,type YuketangCourseProgress,
  type YuketangVideoProgress} from "../bridge";
import type {Course} from "../types";
import type {YuketangVideoSummary} from "../presentation";
import {CourseChapterGroup,CourseRecordToolbar} from "../ui/CourseRecordViews";

type Props={course:Course;desktop:boolean;connected:boolean;scopeDirty:boolean};
type LoadState="idle"|"loading"|"ready"|"blocked"|"error";
type ProgressFilter="all"|"pending"|"done"|"unknown";
const PAGE_SIZE=8;

/** Display precision must never round a non-complete server record up to 100%. */
function verifiedPercentLabel(value:number){
  if(value>0&&value<0.1)return "<0.1%";
  if(value<100)return (Math.floor(value*10)/10).toFixed(1)+"%";
  return "100%";
}

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

/** Only the initial entry automatically checks the full course.
 * Keep authentic server evidence in app memory across route unmounts. */
type Access={desktop:boolean;connected:boolean;scopeDirty:boolean};
type Snapshot={
  videos:YuketangVideoProgress[];total:number;nextOffset:number|null;
  state:LoadState;message:string;checkedAt:number|null;lastPlaybackAt:number|null;
  scanningCount:number;scanningTotal:number|null;resumeOffset:number|null;
};
type PartialScan={videos:YuketangVideoProgress[];total:number|null;cursor:number};
type Entry={
  snapshot:Snapshot;listeners:Set<()=>void>;revision:number;attempted:boolean;
  fullRun:Promise<void>|null;pending:PartialScan|null;
  targetRequests:Set<string>;targetAttempts:Map<string,number>;
};
const entries=new Map<string,Entry>();
const summaryListeners=new Set<()=>void>();
let summaryRevision=0;
/** App-level subscription keeps the header and cards updated without rescanning. */
export function subscribeYuketangVerification(listener:()=>void){
  summaryListeners.add(listener);
  return ()=>{summaryListeners.delete(listener);};
}
export function getYuketangVerificationRevision(){return summaryRevision;}
export function getYuketangVideoSummary(courseId:string):YuketangVideoSummary|null{
  const snapshot=entries.get(courseId)?.snapshot;
  if(!snapshot)return null;
  const verified=snapshot.videos.filter(item=>item.progress_percent!==null&&item.verified_at!==null);
  const completed=verified.filter(item=>item.server_completed===true).length;
  return {total:snapshot.total,verified:verified.length,completed,
    complete:snapshot.checkedAt!==null&&snapshot.nextOffset===null&&
      snapshot.total===snapshot.videos.length,
    scanning:snapshot.state==="loading",checkedAt:snapshot.checkedAt};
}
const emptySnapshot=():Snapshot=>({
  videos:[],total:0,nextOffset:null,state:"idle",message:"",
  checkedAt:null,lastPlaybackAt:null,scanningCount:0,scanningTotal:null,resumeOffset:null
});
function getEntry(courseId:string):Entry{
  let entry=entries.get(courseId);
  if(!entry){
    entry={snapshot:emptySnapshot(),listeners:new Set(),revision:0,
      attempted:false,fullRun:null,pending:null,
      targetRequests:new Set(),targetAttempts:new Map()};
    entries.set(courseId,entry);
  }
  return entry;
}
function publish(entry:Entry,next:Snapshot){
  entry.snapshot=next;
  summaryRevision++;
  for(const listener of entry.listeners)listener();
  for(const listener of summaryListeners)listener();
}

/** Never reuse one login or classroom's evidence with a different scope. */
export function resetYuketangVerification(){
  for(const entry of entries.values()){
    entry.revision++;
    entry.attempted=false;
    entry.fullRun=null;
    entry.pending=null;
    entry.targetRequests.clear();
    entry.targetAttempts.clear();
    publish(entry,emptySnapshot());
  }
}

/** Bounded sequential full-course scan, only on first entry or explicit click. */
export function verifyYuketangCourse(
  courseId:string,access:Access,options:{manual?:boolean;resume?:boolean}={}
):Promise<void>{
  if(!courseId||!access.desktop||!access.connected||access.scopeDirty)return Promise.resolve();
  const entry=getEntry(courseId);
  if(entry.fullRun)return entry.fullRun;
  if(!options.manual&&entry.attempted)return Promise.resolve();
  entry.attempted=true;
  const revision=++entry.revision;
  // Older targeted replies from before a manual scan must not unlock new work.
  entry.targetRequests.clear();
  entry.targetAttempts.clear();
  const keepComplete=entry.snapshot.checkedAt!==null&&entry.snapshot.nextOffset===null;
  const resume=options.resume===true&&entry.pending!==null;
  const partial:PartialScan=resume
    ?{videos:[...entry.pending!.videos],total:entry.pending!.total,cursor:entry.pending!.cursor}
    :{videos:[],total:null,cursor:0};
  entry.pending=null;
  publish(entry,{
    ...entry.snapshot,state:"loading",message:"",scanningCount:partial.videos.length,
    scanningTotal:partial.total,resumeOffset:null
  });
  const run=async()=>{
    let rows=partial.videos;
    let cursor=partial.cursor;
    let total=partial.total;
    try{
      while(true){
        const offset=cursor;
        const data=await request<YuketangCourseProgress>({
          operation:"yuketang.course.detail",course_id:courseId,offset,limit:PAGE_SIZE
        });
        if(revision!==entry.revision)return;
        if(!validPage(data,courseId,offset)||
           (total!==null&&data.total!==total)||
           (data.next_offset!==null&&data.items.length===0))
          throw new Error("INVALID_IPC_RESPONSE");
        total=data.total;
        rows=[...rows,...data.items];
        cursor=data.next_offset??data.total;
        if(data.next_offset===null){
          entry.pending=null;
          publish(entry,{
            ...entry.snapshot,videos:rows,total:data.total,nextOffset:null,
            state:"ready",message:"",checkedAt:Date.now(),
            scanningCount:0,scanningTotal:null,resumeOffset:null
          });
          return;
        }
        // Existing fully verified rows remain on screen until an entire manual
        // replacement scan completes; a first scan may display genuine partial rows.
        publish(entry,{
          ...entry.snapshot,
          ...(!keepComplete?{videos:rows,total:data.total,nextOffset:data.next_offset}:{}),
          state:"loading",scanningCount:rows.length,scanningTotal:data.total
        });
      }
    }catch(error){
      if(revision!==entry.revision)return;
      const reason=friendlyBridgeError(error);
      const invalid=error instanceof Error&&error.message==="INVALID_IPC_RESPONSE";
      entry.pending=!invalid&&rows.length>0?{videos:rows,total,cursor}:null;
      publish(entry,{
        ...entry.snapshot,
        ...(!keepComplete&&rows.length>0?{videos:rows,total:total??rows.length,nextOffset:cursor}:{}),
        state:"error",scanningCount:0,scanningTotal:null,
        resumeOffset:entry.pending?.cursor??null,
        message:keepComplete?"手动刷新未成功，继续显示上次已确认的服务器记录："+reason
          :rows.length>0?"部分视频已读取并保留真实服务器记录；后续批次失败："+reason
            +(entry.pending?"。可从中断位置继续核验。":"。请手动重新核验全课。")
          :reason
      });
    }
  };
  const running=run();
  entry.fullRun=running;
  void running.finally(()=>{if(entry.fullRun===running)entry.fullRun=null;});
  return running;
}

/** Verify a single previously enumerated video by its exact server leaf ID.
 * A fresh server reply may remain below 100%; never infer completion from
 * local end position or from the legacy worker's configurable threshold. */
async function verifyKnownYuketangVideo(
  courseId:string,videoId:string,index:number,access:Access,force=false
):Promise<boolean>{
  if(!courseId||!videoId||!access.desktop||!access.connected||access.scopeDirty)return false;
  const entry=entries.get(courseId);
  if(!entry||entry.fullRun||entry.snapshot.checkedAt===null||
     entry.snapshot.nextOffset!==null)return false;
  const previous=entry.snapshot.videos[index];
  if(!previous||previous.id!==videoId||previous.server_completed===true)return false;
  const now=Date.now();
  if(entry.targetRequests.size>=3||entry.targetRequests.has(videoId)||
     (!force&&now-(entry.targetAttempts.get(videoId)??0)<25_000))return false;
  entry.targetAttempts.set(videoId,now);
  entry.targetRequests.add(videoId);
  const revision=entry.revision;
  try{
    const data=await request<YuketangCourseProgress>({
      operation:"yuketang.course.detail",course_id:courseId,offset:index,limit:1
    });
    if(revision!==entry.revision||entry.fullRun||
       !validPage(data,courseId,index)||data.total!==entry.snapshot.total||
       data.items.length!==1||data.items[0].id!==videoId)return false;
    const confirmed=data.items[0];
    // Missing server evidence must never replace earlier authentic progress.
    if(confirmed.progress_percent===null||confirmed.verified_at===null)return false;
    const updated=[...entry.snapshot.videos];
    if(updated[index]?.id!==videoId)return false;
    updated[index]=confirmed;
    publish(entry,{...entry.snapshot,videos:updated,lastPlaybackAt:Date.now()});
    return true;
  }catch{
    // Preserve the last confirmed server record on a transient read failure.
    return false;
  }finally{
    if(revision===entry.revision)entry.targetRequests.delete(videoId);
  }
}

/** An explicit per-row recheck does not depend on possibly duplicate titles. */
export function verifyYuketangVideoAtIndex(
  courseId:string,videoId:string,index:number,access:Access
):Promise<boolean>{
  return verifyKnownYuketangVideo(courseId,videoId,index,access,true);
}

/** Playback events have only a title: never guess among duplicate names. */
export async function verifyYuketangPlayedVideo(
  courseId:string,videoName:string,access:Access,force=false
):Promise<boolean>{
  if(!courseId||!videoName||!access.desktop||!access.connected||access.scopeDirty)return false;
  const entry=entries.get(courseId);
  if(!entry)return false;
  const exact=videoName.normalize("NFKC").trim();
  const matches=entry.snapshot.videos.flatMap((video,index)=>
    video.name.normalize("NFKC").trim()===exact?[{video,index}]:[]);
  if(matches.length!==1)return false;
  const {video,index}=matches[0];
  return verifyKnownYuketangVideo(courseId,video.id,index,access,force);
}

function reachedServerVideoEnd(video:YuketangVideoProgress){
  return video.progress_percent!==null&&video.server_completed===false&&
    video.last_point_seconds!==null&&video.duration_seconds!==null&&
    video.duration_seconds>0&&video.last_point_seconds>=video.duration_seconds-1;
}

/** Current classroom: UI is a view over the app-session verification snapshot. */
export function YuketangCourseDetailPanel({course,desktop,connected,scopeDirty}:Props){
  const entry=getEntry(course.course_id);
  const subscribe=useCallback((listener:()=>void)=>{
    entry.listeners.add(listener);
    return ()=>{entry.listeners.delete(listener);};
  },[entry]);
  const cached=useSyncExternalStore(subscribe,()=>entry.snapshot,()=>entry.snapshot);
  const blocked=!desktop?"请使用学序 Windows 桌面版读取真实课堂进度。"
    :scopeDirty?"课堂范围尚未保存，请先保存课堂范围，再同步课程列表。"
    :!connected?"雨课堂会话未确认，请检查登录状态。":"";
  const {videos,total,nextOffset,state,message,checkedAt,lastPlaybackAt,scanningCount,scanningTotal,resumeOffset}=
    blocked?{...emptySnapshot(),state:"blocked" as LoadState,message:blocked}:cached;
  const [filter,setFilter]=useState<ProgressFilter>("all");
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const [search,setSearch]=useState("");
  const [chapterFilter,setChapterFilter]=useState("");
  const [checkingVideo,setCheckingVideo]=useState<string|null>(null);
  const [singleCheckMessage,setSingleCheckMessage]=useState("");

  // A route change never invalidates progress and never triggers a second full scan.
  useEffect(()=>{
    void verifyYuketangCourse(course.course_id,{desktop,connected,scopeDirty});
  },[course.course_id,desktop,connected,scopeDirty]);
  useEffect(()=>{
    setFilter("all");setExpanded({});setSearch("");setChapterFilter("");
    setCheckingVideo(null);setSingleCheckMessage("");
  },[course.course_id]);
  const refresh=()=>void verifyYuketangCourse(
    course.course_id,{desktop,connected,scopeDirty},{manual:true});
  const resume=()=>void verifyYuketangCourse(
    course.course_id,{desktop,connected,scopeDirty},{manual:true,resume:true});

  const recheckVideo=async(video:YuketangVideoProgress)=>{
    const index=entry.snapshot.videos.findIndex(item=>item.id===video.id);
    if(index<0)return;
    setCheckingVideo(video.id);
    setSingleCheckMessage("");
    try{
      const confirmed=await verifyYuketangVideoAtIndex(course.course_id,video.id,index,{
        desktop,connected,scopeDirty
      });
      setSingleCheckMessage(confirmed
        ?"已重新读取这一节的服务器进度；是否完成仍以平台返回的记录为准。"
        :"该节服务器复核暂未成功，继续保留上次核验结果。");
    }finally{
      setCheckingVideo(current=>current===video.id?null:current);
    }
  };

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
  // Search/chapter/status filters operate only on authentic fetched records.
  const visibleChapters=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase();
    return chapters.filter(([chapter])=>!chapterFilter||chapterFilter===chapter)
      .map(([chapter,items])=>[chapter,items.filter(video=>
        (filter==="all"||
          (filter==="unknown"&&video.progress_percent===null)||
          (filter==="done"&&video.server_completed===true)||
          (filter==="pending"&&video.progress_percent!==null&&video.server_completed===false))&&
        (!term||video.name.toLocaleLowerCase().includes(term)||chapter.toLocaleLowerCase().includes(term))
      )] as [string,YuketangVideoProgress[]])
      .filter(([,items])=>items.length>0);
  },[chapters,filter,search,chapterFilter]);
  const visibleCount=visibleChapters.reduce((n,[,items])=>n+items.length,0);
  const toggleAll=(open:boolean)=>{
    setExpanded(Object.fromEntries(chapters.map(([name])=>[name,open])));
  };

  return <section className="sf-ykt-course-chapters course-v2-detail sf-zhidao-course-detail sf-unified-records"
    aria-label="雨课堂章节学习进度">
    <div className="sf-zd-detail-heading">
      <div>
        <span className="eyebrow">当前课堂 / 服务器只读记录</span>
        <h3>章节进度</h3>
        <p>首次进入核验全课；之后手动刷新，播放期间仅自动复核能够准确匹配的视频。</p>
      </div>
      <button type="button" className="secondary"
        disabled={!desktop||!connected||scopeDirty||state==="loading"}
        onClick={refresh}>
        <RefreshCw size={14}/>{state==="loading"?"核验全课中…":"重新核验全课"}
      </button>
    </div>
    {checkedAt!==null&&!blocked&&<p className="sf-ykt-scan-state" role="status">上次全课核验：{new Date(checkedAt).toLocaleString()}。返回课程不重复扫描。</p>}
    {lastPlaybackAt!==null&&!blocked&&<p className="sf-ykt-scan-state" role="status">最近播放视频复核 / 单节手动复核：{new Date(lastPlaybackAt).toLocaleString()}（仅对应视频）。</p>}
    {videos.length>0&&<div className="sf-zd-detail-summary sf-ykt-progress-summary sf-record-summary">
      <div><span>已读取视频</span><strong>{videos.length} / {total}</strong></div>
      <div><span>服务器已核验</span><strong>{verified.length} / {videos.length}</strong></div>
      <div><span>已确认完成</span><strong>{completed} 节</strong></div>
    </div>}
    {state==="loading"&&<p className="sf-ykt-scan-state" role="status" aria-live="polite">
      首次或手动全课核验中：本轮已读取 {scanningCount} / {scanningTotal??"…"} 节视频。
    </p>}
    {state==="ready"&&videos.length>0&&<p className="sf-ykt-scan-state" role="status">
      本次已读取 {videos.length} / {total} 节；{unknown>0?unknown+" 节尚无服务器确认记录。":"全部视频均有可确认的服务器进度。"}
    </p>}
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    {singleCheckMessage&&<p className="sf-ykt-scan-state" role="status">{singleCheckMessage}</p>}
    {videos.length>0&&<CourseRecordToolbar key={course.course_id}
      filters={filters} activeFilter={filter} onFilter={value=>setFilter(value as ProgressFilter)}
      search={search} onSearch={setSearch}
      chapters={chapters.map(([name])=>name)} chapter={chapterFilter} onChapter={setChapterFilter}
      visibleCount={visibleCount} totalCount={videos.length} onExpandAll={toggleAll}/>}
    {(state==="ready"||videos.length>0)&&<div className="sf-ykt-videos sf-record-chapters">
      {videos.length===0
        ?<p className="sf-muted">当前课堂没有可识别的视频章节，或课程尚未发布视频。</p>
        :visibleChapters.length===0
          ?<p className="sf-muted">当前已读取的视频没有符合筛选条件的记录。可切换筛选，或继续核验后续视频。</p>
          :visibleChapters.map(([chapter,items],index)=>{
            const allItems=chapters.find(([name])=>name===chapter)?.[1]??items;
            const count=allItems.filter(item=>item.progress_percent!==null).length;
            const done=allItems.filter(item=>item.server_completed===true).length;
            const isExpanded=expanded[chapter]??index===0;
            return <CourseChapterGroup key={chapter} title={chapter}
              meta={`已读取 ${allItems.length} 节 · 已核验 ${count} 节 · 已完成 ${done} 节`}
              expanded={isExpanded} onToggle={()=>setExpanded(previous=>({...previous,[chapter]:!isExpanded}))}>
              {items.map(video=><article className="sf-zd-detail-item sf-record-item" key={video.id}>
                <div className="sf-zd-detail-item-head">
                  <strong>{video.name}</strong>
                  <span className={"sf-record-status is-"+(video.progress_percent===null?"unverified":
                    video.server_completed?"completed":"incomplete")}>
                    {video.progress_percent===null?"未核验":verifiedPercentLabel(video.progress_percent)}
                  </span>
                </div>
                <small>{video.progress_percent===null
                  ?"服务器未返回可确认的进度"
                  :video.server_completed?"服务器已确认完成":"服务器已核验 · 尚未完成"}
                  {video.last_point_seconds!==null&&
                    " · 最后位置 "+duration(video.last_point_seconds)}
                  {video.duration_seconds!==null&&
                    " / 总时长 "+duration(video.duration_seconds)}
                </small>
                {reachedServerVideoEnd(video)&&<small className="sf-muted">
                  播放位置已到末尾，但平台仍未确认完成；可只复核这一节。
                </small>}
                {video.server_completed!==true&&checkedAt!==null&&nextOffset===null&&
                  <button type="button" className="secondary sf-ykt-single-recheck"
                    disabled={!desktop||!connected||scopeDirty||state==="loading"||checkingVideo!==null}
                    onClick={()=>void recheckVideo(video)}>
                    <RefreshCw size={13}/>{checkingVideo===video.id?"复核中…":"只复核此节"}
                  </button>}
                {video.progress_percent!==null&&
                  <div className="sf-zd-detail-track" role="progressbar" aria-label={video.name+"服务器进度"}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={video.progress_percent}>
                    <span style={{width:video.progress_percent+"%"}}/>
                  </div>}
              </article>)}
            </CourseChapterGroup>;
          })}
    </div>}
    {resumeOffset!==null&&state==="error"&&<div className="actions sf-ykt-page-actions">
      <button type="button" className="secondary"
        disabled={!connected||scopeDirty}
        onClick={resume}>
        {"继续核验剩余视频（剩余 "+Math.max(0,total-resumeOffset)+" 节）"}
      </button>
    </div>}
    <details className="sf-technical-note">
      <summary>进度口径</summary>
      <p className="sf-muted">首次进入或手动刷新时逐批核验全课（每批最多 {PAGE_SIZE} 节）；播放中仅按唯一名称定位的视频进行单节服务器只读复核，结束后有限补查，也可手动复核某一节。统计只包括真实服务端记录。
        未核验不等于 0%，本地播放位置和任务日志不等于服务器学习进度。</p>
    </details>
  </section>;
}
