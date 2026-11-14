import {useCallback,useEffect,useRef,useState} from "react";
import {RefreshCw,ShieldCheck} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoProgressSnapshot} from "../bridge";
import {presentCourse} from "../presentation";
import type {Course} from "../types";
import type {TaskRecorder} from "../activity";
import {Switch} from "../ui/Switch";

type EventResult="success"|"warning";
type Props={
  courses:Course[];
  desktop:boolean;
  connected:boolean;
  onCoursesUpdated:(courses:Course[])=>void;
  onEvent?:TaskRecorder;
  courseId?:string;
  courseTitle?:string;
  detailMode?:boolean;
};

export function ZhidaoProgressPanel({courses,desktop,connected,onCoursesUpdated,onEvent,courseId,courseTitle,detailMode=false}:Props){
  const [selected,setSelected]=useState(courseId??"");
  const [monitor,setMonitor]=useState(false);
  const [busy,setBusy]=useState<"sync"|"verify"|null>(null);
  const [message,setMessage]=useState("");
  const [incomplete,setIncomplete]=useState(false);
  const [fetchedAt,setFetchedAt]=useState<string|null>(null);
  const busyRef=useRef(false);
  const onCoursesUpdatedRef=useRef(onCoursesUpdated);
  const onEventRef=useRef(onEvent);
  useEffect(()=>{onCoursesUpdatedRef.current=onCoursesUpdated;},[onCoursesUpdated]);
  useEffect(()=>{onEventRef.current=onEvent;},[onEvent]);
  const current=courses.find(course=>course.course_id===selected)??null;
  const view=current?presentCourse(current):null;

  useEffect(()=>{
    if(courseId){
      if(courses.some(course=>course.course_id===courseId)&&selected!==courseId)setSelected(courseId);
      return;
    }
    if(!courses.some(course=>course.course_id===selected))
      setSelected(courses[0]?.course_id??"");
  },[courses,selected,courseId]);

  const run=useCallback(async(kind:"sync"|"verify",quiet=false)=>{
    if(!desktop||!connected||busyRef.current||(kind==="verify"&&!selected))return;
    busyRef.current=true;setBusy(kind);
    if(!quiet)setMessage("");
    try{
      const snapshot=kind==="sync"
        ?await request<ZhidaoProgressSnapshot>({operation:"zhidao.progress.sync"})
        :await request<ZhidaoProgressSnapshot>({operation:"zhidao.progress.verify",course_key:selected});
      onCoursesUpdatedRef.current(snapshot.courses);
      setIncomplete(snapshot.incomplete);
      setFetchedAt(snapshot.fetched_at);
      if(!quiet){
        const text=snapshot.incomplete
          ?"进度读取已返回，但部分课程未能完成核验；未确认的数据不会显示为已核验。"
          :kind==="sync"?"已完成全部课程的服务器只读进度读取。":"已完成所选课程的服务器只读核验。";
        setMessage(text);
        onEventRef.current?.(kind==="sync"?"同步学习进度":"核验单课进度",snapshot.incomplete?"warning":"success",text,{courseId:kind==="verify"?selected:undefined});
      }
    }catch(error){
      const text=friendlyBridgeError(error);
      if(!quiet){setMessage(text);onEvent?.(kind==="sync"?"同步学习进度":"核验单课进度","warning",text,{courseId:kind==="verify"?selected:undefined});}
    }finally{
      busyRef.current=false;setBusy(null);
    }
  },[desktop,connected,selected]);

  useEffect(()=>{
    if(!monitor||!connected||!selected)return;
    void run("verify",true);
    const timer=window.setInterval(()=>{void run("verify",true);},120000);
    return ()=>window.clearInterval(timer);
  },[monitor,connected,selected,run]);

  const label=current?.course_type==="ai"?"满进度知识点占比":current?.course_type==="shared"?"已完成视频占比":"服务器核验比例";
  const timestamp=current?.verified_at
    ?new Date(current.verified_at).toLocaleString()
    :"尚无当前会话的核验时间";

  return <section className="legacy-playback-panel sf-zhidao-progress-panel">
    <div className="section-head">
      <div><h3><ShieldCheck size={17}/> 知到服务器进度核验</h3></div>
      <span className="legacy-run-state">只读查询</span>
    </div>
    <div className={"sf-zd-progress-grid"+(detailMode?" is-detail":"")}>
      {detailMode
        ?<div className="sf-zd-progress-course"><span>当前核验课程</span><strong>{courseTitle??current?.title??"未选择课程"}</strong></div>
        :<label>
          选择核验课程
          <select value={selected} onChange={event=>setSelected(event.target.value)} disabled={!courses.length||busy!==null}>
            {courses.length===0&&<option value="">暂无已同步课程</option>}
            {courses.map(course=><option key={course.course_id} value={course.course_id}>
              {course.title} · {course.course_type==="ai"?"智慧课程":"共享课"}
            </option>)}
          </select>
        </label>}
      <div className="sf-zd-progress-value">
        <span>{detailMode?"服务器核验状态":label}</span>
        <strong>{detailMode?(view?.status==="verified"?"已核验":view?.status==="cached"?"历史缓存":"待核验"):
          view?.percent===null||view?.percent===undefined?"—":view.percent.toFixed(1)+"%"}</strong>
        <small>{detailMode?(view?.label??"等待课程同步")+" · "+timestamp:
          (view?.label??"等待课程同步")+" · 单课核验："+timestamp}</small>
        <small>最近一次进度同步：{fetchedAt?new Date(fetchedAt).toLocaleString():"尚未同步"}</small>
      </div>
    </div>
    <div className="sf-zd-progress-actions">
      <button className="primary" type="button" disabled={!desktop||!connected||!selected||busy!==null}
        onClick={()=>void run("verify")}>
        <ShieldCheck size={15}/>{busy==="verify"?"核验中…":detailMode?"核验当前课程":"核验选中课程"}
      </button>
      {!detailMode&&<button className="secondary" type="button" disabled={!desktop||!connected||busy!==null}
        onClick={()=>void run("sync")}>
        <RefreshCw size={15}/>{busy==="sync"?"同步中…":"同步全部进度"}
      </button>}
    </div>
    {<div className="sf-zd-progress-auto">
      <div><strong>定时只读核验</strong><small>开启后每 2 分钟核验当前选中课程；默认关闭。</small></div>
      <Switch checked={monitor} onChange={setMonitor} aria-label="开启每两分钟知到单课只读核验"/>
    </div>}
    {message&&<p className="sf-zd-progress-message" role="status">{message}</p>}
    <details className="sf-technical-note"><summary>核验说明</summary><p className="sf-zd-progress-note">
      {incomplete?"本次同步存在未完成项。":"只读取平台已有记录，不提交学习进度。"}
      智慧课程比例统计已达满进度的知识点；共享课比例统计已完成视频数量，均不代表官方课程总进度或观看时长。
    </p></details>
  </section>;
}
