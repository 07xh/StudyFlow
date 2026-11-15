import {useCallback,useEffect,useId,useMemo,useRef,useState} from "react";
import {ChevronDown,ChevronRight,RefreshCw,Search,X} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoCourseDetail} from "../bridge";
import type {Course} from "../types";

type Props={course:Course;desktop:boolean};
type StatusFilter="all"|"incomplete"|"completed"|"unverified";
type Lesson=ZhidaoCourseDetail["items"][number];

function lessonStatus(item:Lesson,kind:ZhidaoCourseDetail["course_type"]):StatusFilter{
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
function seconds(value:number|undefined){
  if(value===undefined||!Number.isFinite(value)||value<0)return "—";
  const n=Math.floor(value);
  return Math.floor(n/60).toString().padStart(2,"0")+":"+String(n%60).padStart(2,"0");
}

/** Use the same primary status filters and grouped chapter hierarchy as Rain Classroom.
 * This panel only filters the existing read-only evidence; it never rewrites progress.
 */
export function ZhidaoCourseDetailPanel({course,desktop}:Props){
  const [detail,setDetail]=useState<ZhidaoCourseDetail|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const revision=useRef(0);
  const detailCourseKey=useRef(course.course_id);
  const [statusFilter,setStatusFilter]=useState<StatusFilter>("all");
  const [searchOpen,setSearchOpen]=useState(false);
  const [search,setSearch]=useState("");
  const [chapterFilter,setChapterFilter]=useState("");
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const searchInput=useRef<HTMLInputElement>(null);
  const searchId=useId();
  const chapterId=useId();

  useEffect(()=>{
    setStatusFilter("all");setSearch("");setSearchOpen(false);
    setChapterFilter("");setExpanded({});
  },[course.course_id]);
  useEffect(()=>{if(searchOpen)searchInput.current?.focus();},[searchOpen]);

  const closeSearch=()=>{
    setSearchOpen(false);
    setSearch("");
  };
  const toggleSearch=()=>{
    if(searchOpen)closeSearch();
    else setSearchOpen(true);
  };

  const load=useCallback(async()=>{
    if(!desktop)return;
    const current=++revision.current;
    setBusy(true);setMessage("");
    // Preserve verified rows for an in-place refresh, never for another course.
    if(detailCourseKey.current!==course.course_id){
      detailCourseKey.current=course.course_id;
      setDetail(null);
    }
    try{
      const result=await request<ZhidaoCourseDetail>({
        operation:"zhidao.course.detail",course_key:course.course_id
      });
      if(current===revision.current)setDetail(result);
    }catch(error){if(current===revision.current){
      setDetail(null);
      setMessage(friendlyBridgeError(error));
    }}
    finally{if(current===revision.current)setBusy(false);}
  },[desktop,course.course_id,course.verified_at,course.stale]);

  useEffect(()=>{void load();return ()=>{revision.current++;};},[load]);

  const currentDetail=detail?.course_key===course.course_id?detail:null;
  const kind:ZhidaoCourseDetail["course_type"]=currentDetail?.course_type??(course.course_type==="ai"?"ai":"shared");
  const items=currentDetail?.items??[];
  const label=kind==="ai"?"知识点":"视频";
  const chapters=useMemo(()=>[...new Set(items.map(chapterOf).filter(Boolean))],[items]);
  const counts=useMemo(()=>{
    const result:{[key in StatusFilter]:number}={all:items.length,incomplete:0,completed:0,unverified:0};
    for(const item of items)result[lessonStatus(item,kind)]++;
    return result;
  },[items,kind]);
  const filters:{id:StatusFilter;label:string}[]=[
    {id:"all",label:"全部"},
    {id:"incomplete",label:"待完成"},
    {id:"completed",label:"已完成"},
    {id:"unverified",label:"未核验"},
  ];
  const filteredItems=useMemo(()=>items.map((item,index)=>({item,index})).filter(({item})=>{
    const key=search.trim().toLocaleLowerCase();
    return (statusFilter==="all"||lessonStatus(item,kind)===statusFilter)&&
      (!chapterFilter||chapterOf(item)===chapterFilter)&&
      (!key||[item.name,item.theme,item.chapter_name].some(value=>value?.toLocaleLowerCase().includes(key)));
  }),[items,kind,statusFilter,chapterFilter,search]);
  const allGroups=useMemo(()=>{
    const groups=new Map<string,number>();
    for(const item of items){
      const group=chapterOf(item)||"其他内容";
      groups.set(group,(groups.get(group)??0)+1);
    }
    return groups;
  },[items]);
  const visibleGroups=useMemo(()=>{
    const groups=new Map<string,typeof filteredItems>();
    for(const entry of filteredItems){
      const group=chapterOf(entry.item)||"其他内容";
      if(!groups.has(group))groups.set(group,[]);
      groups.get(group)!.push(entry);
    }
    return [...groups.entries()];
  },[filteredItems]);
  const toggleAll=(open:boolean)=>{
    setExpanded(Object.fromEntries([...allGroups.keys()].map(group=>[group,open])));
  };

  return <section className="course-v2-detail sf-zhidao-course-detail sf-ykt-course-chapters sf-zd-unified-chapters"
    aria-label="课程章节进度">
    <div className="sf-zd-detail-heading">
      <div>
        <span className="eyebrow">课程内容 / {kind==="ai"?"智慧课程":"共享课程"}</span>
        <h3>章节进度</h3>
        <p>{currentDetail?.verified
          ?(currentDetail.stale?"历史缓存，待重新核验":"服务器已核验")
          :"暂无当前会话可确认的详细学习记录"}
          {currentDetail?.verified_at?" · "+new Date(currentDetail.verified_at).toLocaleString():""}
        </p>
      </div>
      <button className="secondary" type="button" disabled={!desktop||busy} onClick={()=>void load()}>
        <RefreshCw size={14}/>{busy?"读取中…":"刷新章节"}
      </button>
    </div>
    {currentDetail&&<div className="sf-zd-detail-summary sf-ykt-progress-summary">
      <div><span>已完成{label}</span><strong>{currentDetail.done} / {currentDetail.total}</strong></div>
      <div><span>已获取学习状态</span><strong>{counts.all-counts.unverified} / {counts.all}</strong></div>
      <div><span>数据来源</span><strong>{currentDetail.stale?"历史缓存":currentDetail.verified?"服务端记录":"未核验"}</strong></div>
    </div>}
    {items.length>0&&<>
      <div className="sf-ykt-progress-toolbar sf-zd-progress-toolbar" aria-label="章节学习记录筛选">
        <div className="sf-ykt-progress-filters" role="group" aria-label="学习状态">
          {filters.map(option=><button type="button" key={option.id}
            className={statusFilter===option.id?"active":""}
            aria-pressed={statusFilter===option.id}
            onClick={()=>setStatusFilter(option.id)}>
            {option.label} <span>{counts[option.id]}</span>
          </button>)}
        </div>
        <div className="sf-zd-filter-tools">
          {chapters.length>0&&<label className="sf-zd-chapter-select">
            <span>章节 / 主题</span>
            <select aria-label="选择章节或主题" value={chapterFilter}
              onChange={event=>setChapterFilter(event.target.value)}>
              <option value="">全部章节</option>
              {chapters.map(chapter=><option key={chapter} value={chapter}>{chapter}</option>)}
            </select>
          </label>}
          <span className="sf-zd-filter-count" aria-live="polite">
            显示 {filteredItems.length} / {items.length} 条
          </span>
          <button type="button" className={"sf-zd-search-trigger"+(searchOpen?" active":"")}
            aria-label={searchOpen?"关闭搜索":"搜索内容"}
            aria-expanded={searchOpen} aria-controls={searchId} aria-pressed={searchOpen}
            title={searchOpen?"关闭搜索":"搜索知识点、视频或章节"} onClick={toggleSearch}>
            <Search size={16}/>
          </button>
          <div className="sf-ykt-expand-actions sf-zd-expand-actions">
            <button className="secondary" type="button" onClick={()=>toggleAll(true)}>展开全部</button>
            <button className="secondary" type="button" onClick={()=>toggleAll(false)}>收起全部</button>
          </div>
        </div>
      </div>
      {searchOpen&&<div id={searchId} className="sf-zd-search-panel" role="search">
        <Search size={16} aria-hidden="true"/>
        <input ref={searchInput} type="search" aria-label="搜索知识点、视频或章节"
          placeholder="搜索知识点、视频或章节" value={search}
          onChange={event=>setSearch(event.target.value)}
          onKeyDown={event=>{if(event.key==="Escape")closeSearch();}}/>
        <button type="button" className="sf-zd-search-close" aria-label="关闭搜索并清除条件"
          onClick={closeSearch}><X size={16}/></button>
      </div>}
    </>}
    <div className="sf-ykt-videos sf-zd-chapter-groups">
      {busy&&!currentDetail&&<p>正在读取课程章节记录…</p>}
      {items.length===0&&currentDetail&&<p>当前没有可展示的{label}明细。</p>}
      {!currentDetail&&!busy&&!desktop&&<p>请在 Windows 桌面版中读取当前课程的真实章节记录。</p>}
      {items.length>0&&visibleGroups.length===0&&<p>没有符合当前筛选条件的学习记录。</p>}
      {visibleGroups.map(([group,entries],index)=>{
        const isExpanded=expanded[group]??index===0;
        const done=items.filter(item=>(chapterOf(item)||"其他内容")===group&&lessonStatus(item,kind)==="completed").length;
        return <div className="sf-ykt-chapter-group" key={group}>
          <button type="button" className="sf-ykt-chapter-toggle"
            aria-expanded={isExpanded} aria-controls={chapterId+"-"+index}
            onClick={()=>setExpanded(previous=>({...previous,[group]:!isExpanded}))}>
            <span className="sf-ykt-chapter-name">
              {isExpanded?<ChevronDown size={16}/>:<ChevronRight size={16}/>}
              <strong>{group}</strong>
            </span>
            <span className="sf-ykt-chapter-stats">共 {allGroups.get(group)} 项 · 完成 {done} 项</span>
          </button>
          {isExpanded&&<div className="sf-zd-detail-list sf-zd-detail-list-expanded"
            id={chapterId+"-"+index}>
            {entries.map(({item,index:sourceIndex})=>{
              if(kind==="ai"){
                const percent=Math.min(100,Math.max(0,item.progress_percent??0));
                return <article className="sf-zd-detail-item" key={sourceIndex}>
                  <div className="sf-zd-detail-item-head">
                    <strong>{item.name}</strong>
                    <span>{item.progress_percent===undefined?"未核验":percent+"%"}</span>
                  </div>
                  <small>{item.theme||"知识点"} · {item.fully_progressed?"已达满进度":
                    item.progress_percent===undefined?"未核验":"未达满进度"}</small>
                  {item.progress_percent!==undefined&&<div className="sf-zd-detail-track"
                    role="progressbar" aria-label={item.name+"知识点进度"}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <span style={{width:percent+"%"}}/>
                  </div>}
                </article>;
              }
              return <article className="sf-zd-detail-item" key={sourceIndex}>
                <div className="sf-zd-detail-item-head">
                  <strong>{item.name}</strong>
                  <span>{item.server_completed===true?"已完成":
                    item.server_completed===false?"未完成":"未核验"}</span>
                </div>
                <small>已记录 {seconds(item.studied_seconds)} / 总时长 {seconds(item.duration_seconds)}</small>
              </article>;
            })}
          </div>}
        </div>;
      })}
    </div>
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    <details className="sf-technical-note"><summary>数据口径</summary><p className="sf-zd-progress-note">
      {kind==="ai"?"知识点进度来自服务器记录；":"视频完成状态来自服务器记录；"}
      不把本机播放位置换算成服务端进度，也不提交学习记录。
    </p></details>
  </section>;
}
