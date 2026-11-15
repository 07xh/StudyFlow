/** Local restart intent only. Never stores cookies, signatures, heartbeats or server-completion claims. */
import {useEffect,useState} from "react";
import {request,type YuketangScope,type ZhidaoProgressSnapshot} from "./bridge";
import {getLegacyStatus,startLegacy,validateOriginalOptions,validateZhsOptions,
  type OriginalYktOptions,type OriginalZhsOptions} from "./legacyPlayback";
import type {Course} from "./types";
import type {RuntimeTask} from "./runtimeTasks";

const KEY="studyflow.task-recovery.v1";
const EVENT="studyflow:task-recovery";
const MAX_AGE=30*24*60*60*1000;
type RecoverablePlatform="zhidao"|"yuketang";
export type TaskRecoveryRecord={
  version:1;platform:RecoverablePlatform;runId:string;startedAt:number;
  courseId:string|null;classroomId?:string;universityId?:string;
  zhsOptions?:OriginalZhsOptions;yuketangOptions?:OriginalYktOptions;
};
function isRecord(value:unknown):value is TaskRecoveryRecord {
  if(!value||typeof value!=="object")return false;
  const v=value as Partial<TaskRecoveryRecord>;
  if(v.version!==1||(v.platform!=="zhidao"&&v.platform!=="yuketang")||
    typeof v.runId!=="string"||v.runId.length<1||v.runId.length>100||
    typeof v.startedAt!=="number"||!Number.isFinite(v.startedAt)||
    v.startedAt>Date.now()+300000||Date.now()-v.startedAt>MAX_AGE)return false;
  if(v.platform==="zhidao")return typeof v.courseId==="string"&&
    /^[a-f0-9]{64}$/.test(v.courseId)&&!!v.zhsOptions&&validateZhsOptions(v.zhsOptions);
  return v.courseId===null&&typeof v.classroomId==="string"&&v.classroomId.length>0&&
    v.classroomId.length<=100&&typeof v.universityId==="string"&&
    v.universityId.length>0&&v.universityId.length<=100&&
    !!v.yuketangOptions&&validateOriginalOptions(v.yuketangOptions);
}
export function readTaskRecovery():TaskRecoveryRecord[]{
  try {
    const raw=window.localStorage.getItem(KEY);
    if(!raw||raw.length>30000)return [];
    const data:unknown=JSON.parse(raw);
    if(!Array.isArray(data)||data.length>2)return [];
    const valid=data.filter(isRecord) as TaskRecoveryRecord[];
    return valid.filter((item,index)=>valid.findIndex(r=>r.platform===item.platform)===index);
  }catch{return [];}
}
function broadcast(){
  try{window.dispatchEvent(new Event(EVENT));}catch{/* storage may be unavailable */}
}
export function rememberTaskRecovery(record:TaskRecoveryRecord):boolean {
  if(!isRecord(record))return false;
  try{
    const existing=readTaskRecovery().filter(item=>item.platform!==record.platform);
    window.localStorage.setItem(KEY,JSON.stringify([...existing,record]));
    broadcast();
    return true;
  }catch{return false;}
}
export function discardTaskRecovery(platform:RecoverablePlatform,expectedRunId?:string):void{
  try{
    const current=readTaskRecovery();
    if(expectedRunId&&!current.some(item=>item.platform===platform&&item.runId===expectedRunId))return;
    window.localStorage.setItem(KEY,JSON.stringify(current.filter(item=>item.platform!==platform)));
    broadcast();
  }catch{/* intentional stop remains authoritative even if storage is blocked */}
}
function readableFailure(error:unknown):string{
  if(error instanceof Error&&[
    "当前登录或课程已变化，不能恢复原任务。",
    "当前课堂范围与上次不同，不能恢复原任务。",
    "服务器进度未核验成功，暂不恢复。",
    "当前课程记录显示已全部完成，无需恢复。"
  ].includes(error.message))return error.message;
  return "恢复前核验或任务启动失败，请检查网络、登录与课程状态后重试。";
}
export function TaskRecoveryPanel({desktop,consentAccepted,visible,tasks,loading,connected,courses,onRefresh}:{
  desktop:boolean;consentAccepted:boolean;visible:boolean;tasks:RuntimeTask[];loading:boolean;
  connected:Record<RecoverablePlatform,boolean>;courses:Course[];onRefresh:()=>Promise<void>;
}){
  const [records,setRecords]=useState<TaskRecoveryRecord[]>([]);
  const [busy,setBusy]=useState<RecoverablePlatform|null>(null);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    const update=()=>setRecords(readTaskRecovery());
    update();
    // Headless renderers and locked-down embedded shells may have no event API.
    if(typeof window.addEventListener!=="function"||typeof window.removeEventListener!=="function")return;
    window.addEventListener(EVENT,update);window.addEventListener("storage",update);
    return()=>{window.removeEventListener(EVENT,update);window.removeEventListener("storage",update);};
  },[]);
  if(!desktop||!consentAccepted||!visible||loading)return null;
  const pending=records.filter(record=>{
    const task=tasks.find(t=>t.runner===(record.platform==="zhidao"?"zhs":"yuketang"));
    return task?.state!=="running";
  });
  if(!pending.length)return null;
  async function resume(record:TaskRecoveryRecord){
    if(busy)return;
    setBusy(record.platform);setMessage("");
    try{
      if(!connected[record.platform])throw Error("当前登录或课程已变化，不能恢复原任务。");
      // Current native process state takes precedence over a persisted browser hint.
      const latest=await getLegacyStatus(record.platform);
      if(latest.state==="running")throw Error("当前已有任务运行，请先在学习任务中查看。");
      if(record.platform==="zhidao"){
        if(!courses.some(c=>c.platform==="zhidao"&&c.course_id===record.courseId&&!c.stale))
          throw Error("当前登录或课程已变化，不能恢复原任务。");
        const snapshot=await request<ZhidaoProgressSnapshot>({
          operation:"zhidao.progress.verify",course_key:record.courseId!
        });
        const target=snapshot.courses.find(c=>c.platform==="zhidao"&&c.course_id===record.courseId);
        if(!target||target.stale||target.progress_evidence!=="server_verified"||!target.verified_at)
          throw Error("服务器进度未核验成功，暂不恢复。");
        if(target.progress_percent===100)
          throw Error("当前课程记录显示已全部完成，无需恢复。");
      }else{
        const scope=await request<YuketangScope>({operation:"yuketang.scope.get"});
        if(scope.classroom_id!==record.classroomId||scope.university_id!==record.universityId||
          !scope.has_session||!scope.has_sign)
          throw Error("当前课堂范围与上次不同，不能恢复原任务。");
        // A fresh read through the authenticated adapter, not a local progress percentage.
        const coursesNow=await request<Course[]>({operation:"courses.list",platform:"yuketang"});
        if(!Array.isArray(coursesNow)||!coursesNow.some(c=>c.platform==="yuketang"&&!c.stale))
          throw Error("服务器进度未核验成功，暂不恢复。");
      }
      const next=await startLegacy(record.platform,
        record.platform==="zhidao"?record.courseId!:undefined,
        record.platform==="yuketang"?record.yuketangOptions:undefined,
        record.platform==="zhidao"?record.zhsOptions:undefined);
      if(next.state!=="running"||!next.run_id)throw Error("TASK_LAUNCH_NOT_CONFIRMED");
      const persisted=rememberTaskRecovery({...record,runId:next.run_id,startedAt:Date.now()});
      setMessage(persisted?"已重新启动任务；实际学习进度以平台服务器记录为准。":
        "任务已启动，但本地恢复记录保存失败，请检查存储权限。");
      await onRefresh();
    }catch(error){setMessage(readableFailure(error));}
    finally{setBusy(null);}
  }
  return <section className="sf-section" aria-label="上次任务恢复">
    <div className="section-head"><h3>恢复上次学习任务</h3><span className="sf-muted">检测到未确认结束的本机记录</span></div>
    <p className="sf-muted">软件退出时没有继续保留运行进程；恢复会先核对当前账号、课程范围及服务器进度。不会把本地播放位置当成已完成。</p>
    {pending.map(record=>{
      const runner=record.platform==="zhidao"?"zhs":"yuketang";
      const task=tasks.find(t=>t.runner===runner);
      const course=record.platform==="zhidao"?courses.find(c=>c.platform==="zhidao"&&c.course_id===record.courseId&&!c.stale):null;
      const disabled=!!busy||!connected[record.platform]||!!task?.unavailable;
      return <article className="sf-runtime-task" key={record.platform}>
        <div className="section-head">
          <strong>{record.platform==="zhidao"?"知到 · "+(course?.title??"原课程待核验"):"雨课堂 · 上次课堂批量任务"}</strong>
          <small>{new Date(record.startedAt).toLocaleString()}</small>
        </div>
        <div className="actions">
          <button type="button" disabled={disabled} onClick={()=>void resume(record)}>
            {busy===record.platform?"正在核验…":"核验并恢复"}
          </button>
          <button type="button" className="secondary" disabled={!!busy}
            onClick={()=>{discardTaskRecovery(record.platform,record.runId);setMessage("已放弃本机恢复记录，不影响服务器课程进度。");}}>
            不恢复
          </button>
        </div>
        {!connected[record.platform]&&<p className="sf-muted">请先确认该平台已登录并同步课程。</p>}
        {task?.unavailable&&<p className="sf-muted">本机任务状态不可读取，暂时禁止恢复。</p>}
      </article>;
    })}
    {message&&<p role="status">{message}</p>}
  </section>;
}
