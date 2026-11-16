import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {RefreshCw} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoCourseDetail,type ZhidaoProgressSnapshot} from "../bridge";
import type {Course} from "../types";
import {CourseChapterGroup,CourseRecordToolbar} from "../ui/CourseRecordViews";

type Props={course:Course;desktop:boolean;onCoursesUpdated?:(courses:Course[])=>void};
type StatusFilter="all"|"incomplete"|"completed"|"unverified";
type Lesson=ZhidaoCourseDetail["items"][number];

function lessonStatus(item:Lesson,kind:ZhidaoCourseDetail["course_type"]):Exclude<StatusFilter,"all">{
  if(kind==="ai"){
    if(item.fully_progressed===true)return "completed";
    if(typeof item.progress_percent!=="number"||!Number.isFinite(item.progress_percent))return "unverified";
    return "incomplete";
  }
  if(item.server_completed===true)return "completed";
  if(item.server_completed===false)return "incomplete";
  return "unverified";
}
function chapterOf(item:Lesson){return (item.chapter_name||item.theme||"").trim();}
function groupName(item:Lesson){return chapterOf(item)||"其他内容";}
function seconds(value:number|undefined){
  if(value===undefined||!Number.isFinite(value)||value<0)return "—";
  const n=Math.floor(value);
  return Math.floor(n/60).toString().padStart(2,"0")+":"+String(n%60).padStart(2,"0");
}

/** Real Zhidao course records; course-level metric remains in the workspace header. */
export function ZhidaoCourseDetailPanel({course,desktop,onCoursesUpdated}:Props){
  const [detail,setDetail]=useState<ZhidaoCourseDetail|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const revision=useRef(0);
  const detailCourseKey=useRef(course.course_id);
  const onCoursesUpdatedRef=useRef(onCoursesUpdated);
  onCoursesUpdatedRef.current=onCoursesUpdated;
  const [statusFilter,setStatusFilter]=useState<StatusFilter>("all");
  const [search,setSearch]=useState("");
  const [chapterFilter,setChapterFilter]=useState("");
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  useEffect(()=>{
    setStatusFilter("all");setSearch("");setChapterFilter("");setExpanded({});
  },[course.course_id]);

  const load=useCallback(async(verifyServer=false)=>{
    if(!desktop)return;
    const current=++revision.current;
    setBusy(true);setMessage("");
    if(detailCourseKey.current!==course.course_id){
      detailCourseKey.current=course.course_id;
      setDetail(null);
    }
    let cached:ZhidaoCourseDetail|null=null;
    try{
      cached=await request<ZhidaoCourseDetail>({
        operation:"zhidao.course.detail",course_key:course.course_id
      });
      if(current!==revision.current)return;
      if(cached.course_key!==course.course_id)throw new Error("COURSE_NOT_FOUND");
      setDetail(cached);
      // The detail endpoint reads a local cache. On a newly selected course with
      // no usable chapter evidence, query the real server before declaring it empty.
      // A manual refresh always requests new server evidence.
      const missingEvidence=!cached.verified||cached.stale||cached.items.length===0;
      if(!verifyServer&&(!missingEvidence||course.stale))return;
      const snapshot=await request<ZhidaoProgressSnapshot>({
        operation:"zhidao.progress.verify",course_key:course.course_id
      });
      if(current!==revision.current)return;
      const target=snapshot.courses.find(item=>item.platform==="zhidao"&&
        item.course_id===course.course_id&&!item.stale);
      if(!target)throw new Error("COURSE_NOT_FOUND");
      onCoursesUpdatedRef.current?.(snapshot.courses);
      const updated=await request<ZhidaoCourseDetail>({
        operation:"zhidao.course.detail",course_key:course.course_id
      });
      if(current!==revision.current)return;
      if(updated.course_key!==course.course_id)throw new Error("COURSE_NOT_FOUND");
      setDetail(updated);
      if(!updated.verified)setMessage("已重新读取课程，但服务器尚未提供可核验的章节进度。");
    }catch(error){
      if(current===revision.current){
        // Keep valid cache evidence on a transient verification failure, without
        // claiming the failed request supplied fresh server progress.
        if(!cached||cached.course_key!==course.course_id)setDetail(null);
        setMessage("当前课程读取或服务器核验失败："+friendlyBridgeError(error));
      }
    }finally{if(current===revision.current)setBusy(false);}
  },[desktop,course.course_id,course.verified_at,course.stale]);
  useEffect(()=>{void load();return ()=>{revision.current++;};},[load]);

  // Never present records belonging to a previously selected course.
  const currentDetail=detail?.course_key===course.course_id?detail:null;
  const kind:ZhidaoCourseDetail["course_type"]=currentDetail?.course_type??(course.course_type==="ai"?"ai":"shared");
  const items=currentDetail?.items??[];
  const label=kind==="ai"?"知识点":"视频";
  const chapters=useMemo(()=>[...new Set(items.map(chapterOf).filter(Boolean))],[items]);
  const filteredItems=useMemo(()=>items.map((item,index)=>({item,index})).filter(({item})=>{
    const key=search.trim().toLocaleLowerCase();
    return (statusFilter==="all"||lessonStatus(item,kind)===statusFilter)&&
      (!chapterFilter||chapterOf(item)===chapterFilter)&&
      (!key||[item.name,item.theme,item.chapter_name].some(value=>value?.toLocaleLowerCase().includes(key)));
  }),[items,kind,statusFilter,chapterFilter,search]);
  const groups=useMemo(()=>{
    const result=new Map<string,typeof filteredItems>();
    for(const record of filteredItems){
      const name=groupName(record.item);
      if(!result.has(name))result.set(name,[]);
      result.get(name)!.push(record);
    }
    return [...result.entries()];
  },[filteredItems]);
  const counts=useMemo(()=>{
    const result={all:items.length,incomplete:0,completed:0,unverified:0};
    for(const item of items)result[lessonStatus(item,kind)]++;
    return result;
  },[items,kind]);
  const allGroups=useMemo(()=>{
    const result=new Map<string,Lesson[]>();
    for(const item of items){
      const name=groupName(item);
      if(!result.has(name))result.set(name,[]);
      result.get(name)!.push(item);
    }
    return result;
  },[items]);
  const options=[
    {id:"all",label:"全部",count:counts.all},
    {id:"incomplete",label:"待完成",count:counts.incomplete},
    {id:"completed",label:"已完成",count:counts.completed},
    {id:"unverified",label:"未核验",count:counts.unverified},
  ];
  const toggleAll=(open:boolean)=>{
    setExpanded(Object.fromEntries([...allGroups.keys()].map(name=>[name,open])));
  };
  const evidence=currentDetail?.stale?"历史缓存":currentDetail?.verified?"服务端记录":"未核验";
  const completeLabel=currentDetail?.verified&&!currentDetail.stale?"服务端已完成":"记录已完成";
  return <section className="course-v2-detail sf-zhidao-course-detail sf-unified-records"
    aria-label="课程章节进度">
    <div className="sf-zd-detail-heading">
      <div>
        <span className="eyebrow">{kind==="ai"?"智慧课程":"共享课程"}</span>
        <h3>章节进度</h3>
        {currentDetail?.verified_at&&<small className="sf-record-verification-meta">最近核验：{new Date(currentDetail.verified_at).toLocaleString()}</small>}
      </div>
      <button className="secondary" type="button" disabled={!desktop||busy} onClick={()=>void load(true)}>
        <RefreshCw size={14}/>{busy?"核验中…":"刷新章节"}
      </button>
    </div>
    {currentDetail&&<div className="sf-zd-detail-summary sf-record-summary">
      <div><span>已读取{label}</span><strong>{items.length} 条</strong></div>
      <div><span>{completeLabel}</span><strong>{currentDetail.done} / {currentDetail.total}</strong></div>
      <div><span>数据来源</span><strong>{evidence}</strong></div>
    </div>}
    {items.length>0&&<CourseRecordToolbar key={course.course_id}
      filters={options} activeFilter={statusFilter} onFilter={value=>setStatusFilter(value as StatusFilter)}
      search={search} onSearch={setSearch}
      chapters={chapters} chapter={chapterFilter} onChapter={setChapterFilter}
      visibleCount={filteredItems.length} totalCount={items.length} onExpandAll={toggleAll}/>}
    <div className="sf-record-chapters">
      {busy&&!currentDetail&&<p role="status">正在读取课程章节记录…</p>}
      {items.length===0&&currentDetail&&<p>当前没有可展示的{label}明细。</p>}
      {!currentDetail&&!busy&&!desktop&&<p>请在 Windows 桌面版中读取当前课程的真实章节记录。</p>}
      {items.length>0&&filteredItems.length===0&&<p>没有符合当前筛选条件的学习记录。</p>}
      {groups.map(([chapter,records],groupIndex)=>{
        const all=allGroups.get(chapter)??records.map(({item})=>item);
        const completed=all.filter(item=>lessonStatus(item,kind)==="completed").length;
        const verified=all.filter(item=>lessonStatus(item,kind)!=="unverified").length;
        const open=expanded[chapter]??groupIndex===0;
        return <CourseChapterGroup key={chapter} title={chapter}
          meta={`${all.length} 项 · ${verified} 核验 · ${completed} 完成`}
          expanded={open}
          onToggle={()=>setExpanded(previous=>({...previous,[chapter]:!open}))}>
          {records.map(({item,index})=>{
            const status=lessonStatus(item,kind);
            const validPercent=typeof item.progress_percent==="number"&&Number.isFinite(item.progress_percent);
            const percent=validPercent?Math.max(0,Math.min(100,item.progress_percent!)):null;
            return <article className="sf-zd-detail-item sf-record-item" key={index}>
              <div className="sf-zd-detail-item-head">
                <strong>{item.name}</strong>
                <span className={"sf-record-status is-"+status}>
                  {kind==="ai"?(status==="completed"&&percent===null?"已达满进度":
                    percent===null?"未核验":percent+"%")
                    :status==="completed"?"已完成":status==="incomplete"?"未完成":"未核验"}
                </span>
              </div>
              <small>{kind==="ai"
                ?(item.theme||"知识点")
                :"已记录 "+seconds(item.studied_seconds)+" / 总时长 "+seconds(item.duration_seconds)}
                {currentDetail?.stale?" · 历史缓存":""}
              </small>
              {kind==="ai"&&percent!==null&&
                <div className="sf-zd-detail-track" role="progressbar"
                  aria-label={item.name+"知识点进度"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <span style={{width:percent+"%"}}/>
                </div>}
            </article>;
          })}
        </CourseChapterGroup>;
      })}
    </div>
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    <details className="sf-technical-note"><summary>数据口径</summary><p className="sf-zd-progress-note">
      智慧课程知识点的满进度与课程总体进度是不同指标；共享课按服务端视频记录显示。
      未核验不等于未完成，历史缓存不等于当前服务器核验，不提交学习记录。
    </p></details>
  </section>;
}
