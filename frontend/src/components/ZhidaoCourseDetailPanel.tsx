import {useCallback,useEffect,useState} from "react";
import {RefreshCw,ShieldCheck} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoCourseDetail,type ZhidaoProgressSnapshot} from "../bridge";
import type {Course} from "../types";

type Props={course:Course;desktop:boolean;onCoursesUpdated:(courses:Course[])=>void};
function seconds(value:number|undefined){
  if(value===undefined||!Number.isFinite(value)||value<0)return "—";
  const n=Math.floor(value);
  return Math.floor(n/60).toString().padStart(2,"0")+":"+String(n%60).padStart(2,"0");
}
export function ZhidaoCourseDetailPanel({course,desktop,onCoursesUpdated}:Props){
  const [detail,setDetail]=useState<ZhidaoCourseDetail|null>(null);
  const [busy,setBusy]=useState<"load"|"verify"|null>(null);
  const [message,setMessage]=useState("");

  const load=useCallback(async()=>{
    if(!desktop)return;
    setBusy("load");setMessage("");
    try{
      const result=await request<ZhidaoCourseDetail>({
        operation:"zhidao.course.detail",course_key:course.course_id
      });
      setDetail(result);
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(null);}
  },[desktop,course.course_id]);

  useEffect(()=>{void load();},[load]);

  async function verify(){
    if(!desktop)return;
    setBusy("verify");setMessage("");
    try{
      const snapshot=await request<ZhidaoProgressSnapshot>({
        operation:"zhidao.progress.verify",course_key:course.course_id
      });
      onCoursesUpdated(snapshot.courses);
      const next=await request<ZhidaoCourseDetail>({
        operation:"zhidao.course.detail",course_key:course.course_id
      });
      setDetail(next);
      setMessage(snapshot.incomplete?"已返回单课记录，但全局同步仍有未完成项。":"已重新核验该课程的服务器记录。");
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(null);}
  }

  const kind=detail?.course_type??course.course_type;
  const items=detail?.items??[];
  const label=kind==="ai"?"知识点":"视频";
  return <section className="course-v2-detail sf-zhidao-course-detail" aria-label="知到课程详情">
    <div className="sf-zd-detail-heading">
      <div>
        <span className="eyebrow">知到 / {kind==="ai"?"智慧课程":"共享课程"}</span>
        <h3>{detail?.title??course.title}</h3>
        <p>{detail?.verified
          ?(detail.stale?"历史缓存，待重新核验":"服务器已核验")
          :"暂无当前会话可确认的详细学习记录"}
          {detail?.verified_at?" · "+new Date(detail.verified_at).toLocaleString():""}</p>
      </div>
      <div className="sf-zd-detail-actions">
        <button className="secondary" type="button" disabled={!desktop||busy!==null} onClick={()=>void load()}>
          <RefreshCw size={14}/>刷新详情
        </button>
        <button className="primary" type="button" disabled={!desktop||busy!==null} onClick={()=>void verify()}>
          <ShieldCheck size={14}/>{busy==="verify"?"核验中…":"核验此课"}
        </button>
      </div>
    </div>
    {detail&&<div className="sf-zd-detail-summary">
      <div><span>已完成{label}</span><strong>{detail.done} / {detail.total}</strong></div>
      <div><span>{kind==="ai"?"满进度知识点占比":"已完成视频占比"}</span>
        <strong>{detail.percent===null?"—":detail.percent.toFixed(1)+"%"}</strong></div>
      <div><span>记录状态</span><strong>{detail.stale?"历史记录":detail.verified?"已核验":"未核验"}</strong></div>
    </div>}
    <div className="sf-zd-detail-list">
      {busy==="load"&&!detail&&<p>正在读取本机已保存的服务器记录…</p>}
      {items.length===0&&detail&&<p>当前没有可展示的{label}明细。可重新核验此课后再查看。</p>}
      {items.map((item,index)=>{
        if(kind==="ai"){
          const percent=item.progress_percent??0;
          return <article className="sf-zd-detail-item" key={index}>
            <div className="sf-zd-detail-item-head">
              <strong>{item.name}</strong><span>{percent}%</span>
            </div>
            <small>{item.theme||"知识点"} · {item.fully_progressed?"已达满进度":"未达满进度"}</small>
            <div className="sf-zd-detail-track" role="progressbar" aria-label={item.name+"知识点进度"}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span style={{width:percent+"%"}}/>
            </div>
          </article>;
        }
        return <article className="sf-zd-detail-item" key={index}>
          <div className="sf-zd-detail-item-head">
            <strong>{item.name}</strong><span>{item.server_completed?"服务器记录已完成":"未完成 / 未确认"}</span>
          </div>
          <small>已记录 {seconds(item.studied_seconds)} / 总时长 {seconds(item.duration_seconds)}</small>
        </article>;
      })}
    </div>
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    <p className="sf-zd-progress-note">
      {kind==="ai"?"知识点满进度占比不等于官方课程总进度或掌握度。":"视频完成数量不等于实际观看时长。"}
      明细来自当前登录会话的只读缓存；本页面不会提交学习记录。
    </p>
  </section>;
}
