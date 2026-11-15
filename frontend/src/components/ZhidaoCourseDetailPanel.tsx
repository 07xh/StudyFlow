import {useCallback,useEffect,useRef,useState} from "react";
import {RefreshCw} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoCourseDetail} from "../bridge";
import type {Course} from "../types";

type Props={course:Course;desktop:boolean};
function seconds(value:number|undefined){
  if(value===undefined||!Number.isFinite(value)||value<0)return "—";
  const n=Math.floor(value);
  return Math.floor(n/60).toString().padStart(2,"0")+":"+String(n%60).padStart(2,"0");
}

/** Course-level total progress lives in the workspace header; this panel only renders lesson items. */
export function ZhidaoCourseDetailPanel({course,desktop}:Props){
  const [detail,setDetail]=useState<ZhidaoCourseDetail|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const revision=useRef(0);
  const detailCourseKey=useRef(course.course_id);

  const load=useCallback(async()=>{
    if(!desktop)return;
    const current=++revision.current;
    setBusy(true);setMessage("");
    // Preserve the previous verified chapter rows during a same-course refresh.
    // A different course must never briefly display the old course's rows.
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
      // An actual read failure must not leave old rows looking current.
      setDetail(null);
      setMessage(friendlyBridgeError(error));
    }}
    finally{if(current===revision.current)setBusy(false);}
  },[desktop,course.course_id,course.verified_at,course.stale]);

  useEffect(()=>{void load();return ()=>{revision.current++;};},[load]);

  const kind=detail?.course_type??course.course_type;
  const items=detail?.items??[];
  const label=kind==="ai"?"知识点":"视频";
  return <section className="course-v2-detail sf-zhidao-course-detail" aria-label="课程章节进度">
    <div className="sf-zd-detail-heading">
      <div>
        <span className="eyebrow">课程内容 / {kind==="ai"?"智慧课程":"共享课程"}</span>
        <h3>章节进度</h3>
        <p>{detail?.verified
          ?(detail.stale?"历史缓存，待重新核验":"服务器已核验")
          :"暂无当前会话可确认的详细学习记录"}
          {detail?.verified_at?" · "+new Date(detail.verified_at).toLocaleString():""}
        </p>
      </div>
      <button className="secondary" type="button" disabled={!desktop||busy} onClick={()=>void load()}>
        <RefreshCw size={14}/>{busy?"读取中…":"刷新章节"}
      </button>
    </div>
    {detail&&<div className="sf-zd-detail-summary sf-zd-detail-summary-compact">
      <div><span>已完成{label}</span><strong>{detail.done} / {detail.total}</strong></div>
      <div><span>数据来源</span><strong>{detail.stale?"历史缓存":detail.verified?"服务端记录":"未核验"}</strong></div>
    </div>}
    <div className="sf-zd-detail-list sf-zd-detail-list-expanded">
      {busy&&!detail&&<p>正在读取课程章节记录…</p>}
      {items.length===0&&detail&&<p>当前没有可展示的{label}明细。</p>}
      {!detail&&!busy&&!desktop&&<p>请在 Windows 桌面版中读取当前课程的真实章节记录。</p>}
      {items.map((item,index)=>{
        if(kind==="ai"){
          const percent=Math.min(100,Math.max(0,item.progress_percent??0));
          return <article className="sf-zd-detail-item" key={index}>
            <div className="sf-zd-detail-item-head">
              <strong>{item.name}</strong><span>{item.progress_percent===undefined?"未核验":percent+"%"}</span>
            </div>
            <small>{item.theme||"知识点"} · {item.fully_progressed?"已达满进度":"未达满进度"}</small>
            {item.progress_percent!==undefined&&<div className="sf-zd-detail-track" role="progressbar"
              aria-label={item.name+"知识点进度"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span style={{width:percent+"%"}}/>
            </div>}
          </article>;
        }
        return <article className="sf-zd-detail-item" key={index}>
          <div className="sf-zd-detail-item-head">
            <strong>{item.name}</strong><span>{item.server_completed?"已完成":"未完成 / 未确认"}</span>
          </div>
          <small>已记录 {seconds(item.studied_seconds)} / 总时长 {seconds(item.duration_seconds)}</small>
        </article>;
      })}
    </div>
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    <details className="sf-technical-note"><summary>数据口径</summary><p className="sf-zd-progress-note">
      {kind==="ai"?"知识点进度来自服务器记录；":"视频完成状态来自服务器记录；"}
      不把本机播放位置换算成服务端进度，也不提交学习记录。
    </p></details>
  </section>;
}
