import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {RefreshCw} from "lucide-react";
import {friendlyBridgeError,request,type YuketangCourseProgress,
  type YuketangVideoProgress} from "../bridge";
import type {Course} from "../types";
import {CourseChapterGroup,CourseRecordToolbar} from "../ui/CourseRecordViews";

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
  const [search,setSearch]=useState("");
  const [chapterFilter,setChapterFilter]=useState("");

  // One user action verifies the whole course. Keep requests within the existing
  // server-side limit and run them sequentially to avoid an unbounded burst.
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
    let cursor=offset;
    let expectedTotal:number|null=null;
    let loadedInThisRun=0;
    try{
      while(true){
        const pageOffset=cursor;
        const result=await request<YuketangCourseProgress>({
          operation:"yuketang.course.detail",course_id:course.course_id,
          offset:pageOffset,limit:PAGE_SIZE
        });
        if(current!==revision.current)return;
        if(!validPage(result,course.course_id,pageOffset)||
          (expectedTotal!==null&&result.total!==expectedTotal)||
          (result.next_offset!==null&&result.items.length===0))
          throw new Error("INVALID_IPC_RESPONSE");
        expectedTotal=result.total;
        // Only append validated server evidence; a failed later page must not
        // erase successfully checked earlier pages or imply completion.
        setVideos(previous=>reset&&pageOffset===offset?result.items:[...previous,...result.items]);
        loadedInThisRun+=result.items.length;
        setTotal(result.total);
        setNextOffset(result.next_offset);
        if(result.next_offset===null){
          setState("ready");
          return;
        }
        cursor=result.next_offset;
      }
    }catch(error){
      if(current!==revision.current)return;
      setState("error");
      const reason=friendlyBridgeError(error);
      setMessage(loadedInThisRun>0
        ?"部分视频已读取并保留真实服务器记录；后续批次失败："+reason+"。可从中断位置继续核验。"
        :reason);
    }
  },[course.course_id,desktop,connected,scopeDirty]);

  useEffect(()=>{void load(0,true);return()=>{revision.current++;};},[load]);

  useEffect(()=>{
    setFilter("all");
    setExpanded({});
    setSearch("");
    setChapterFilter("");
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
        <p>自动逐批读取全部视频的真实服务器进度；未核验内容不推断完成状态。</p>
      </div>
      <button type="button" className="secondary"
        disabled={!desktop||!connected||scopeDirty||state==="loading"}
        onClick={()=>void load(0,true)}>
        <RefreshCw size={14}/>{state==="loading"?"核验全课中…":"重新核验全课"}
      </button>
    </div>
    {videos.length>0&&<div className="sf-zd-detail-summary sf-ykt-progress-summary sf-record-summary">
      <div><span>已读取视频</span><strong>{videos.length} / {total}</strong></div>
      <div><span>服务器已核验</span><strong>{verified.length} / {videos.length}</strong></div>
      <div><span>已确认完成</span><strong>{completed} 节</strong></div>
    </div>}
    {state==="loading"&&<p className="sf-ykt-scan-state" role="status" aria-live="polite">
      正在自动核验全课：已读取 {videos.length} / {total||"…"} 节视频，按批次连续读取，无需手动翻页。
    </p>}
    {state==="ready"&&videos.length>0&&<p className="sf-ykt-scan-state" role="status">
      本次已读取 {videos.length} / {total} 节；{unknown>0?unknown+" 节尚无服务器确认记录。":"全部视频均有可确认的服务器进度。"}
    </p>}
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    {videos.length>0&&<CourseRecordToolbar
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
                    {video.progress_percent===null?"未核验":video.progress_percent.toFixed(1)+"%"}
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
                {video.progress_percent!==null&&
                  <div className="sf-zd-detail-track" role="progressbar" aria-label={video.name+"服务器进度"}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={video.progress_percent}>
                    <span style={{width:video.progress_percent+"%"}}/>
                  </div>}
              </article>)}
            </CourseChapterGroup>;
          })}
    </div>}
    {nextOffset!==null&&state==="error"&&<div className="actions sf-ykt-page-actions">
      <button type="button" className="secondary"
        disabled={!connected||scopeDirty}
        onClick={()=>void load(nextOffset,false)}>
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
