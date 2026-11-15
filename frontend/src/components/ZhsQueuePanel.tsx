import {useEffect,useRef,useState} from "react";
import {Square} from "lucide-react";
import {stopZhsVideo,legacyError,legacyExitMessage,zhsDiagnosticMessage,type LegacyTaskStatus} from "../legacyPlayback";

const labels:Record<string,string>={queued:"排队中",running:"运行中",exited:"本轮结束 · 待核验",
  failed:"执行失败",stopped:"已停止",unknown:"状态待核实"};
const kinds={video:"视频",ppt:"PPT",article:"文章",other:"其他资源"};
export function ZhsQueuePanel({status,unavailable=false,onRefresh}:{
  status:LegacyTaskStatus;unavailable?:boolean;onRefresh:()=>Promise<void>;
}){
  const [requested,setRequested]=useState<Set<string>>(new Set());
  const [message,setMessage]=useState("");
  const currentRun=useRef(status.run_id);
  currentRun.current=status.run_id;
  useEffect(()=>{setRequested(new Set());setMessage("");},[status.run_id]);
  const queue=status.zhs_queue;
  if(!queue)return null;
  const stale=unavailable||queue.stale;
  const active=status.state==="running"&&!stale;
  const playing=queue.tasks.filter(t=>t.state==="running");
  const waiting=queue.tasks.filter(t=>t.state==="queued");
  const ended=queue.tasks.filter(t=>t.state!=="queued"&&t.state!=="running");
  async function stop(id:string){
    const run=status.run_id;
    if(!run||!active||requested.has(id))return;
    setRequested(previous=>new Set([...previous,id]));setMessage("");
    try{
      await stopZhsVideo(run,id);
      if(currentRun.current!==run)return;
      setMessage("停止请求已提交，正在等待此视频退出。");
      await onRefresh();
    }catch(error){
      if(currentRun.current!==run)return;
      setRequested(previous=>new Set([...previous].filter(value=>value!==id)));
      setMessage(legacyError(error));
    }
  }
  function row(task:NonNullable<LegacyTaskStatus["zhs_queue"]>["tasks"][number]){
    const inProgress=task.state==="queued"||task.state==="running";
    const pendingStop=active&&inProgress&&requested.has(task.task_id);
    const percent=!stale&&!task.stale&&task.kind==="video"&&task.state==="running"?task.percent:null;
    return <article className="sf-ykt-worker" key={task.task_id}>
      <div className="sf-ykt-worker-heading">
        <span>{kinds[task.kind]} · {stale&&inProgress?"状态待核实":pendingStop?"正在停止":labels[task.state]}</span>
        {inProgress&&<button type="button" className="secondary" aria-label={"停止"+(task.name??"此资源")}
          disabled={!active||pendingStop} onClick={()=>void stop(task.task_id)}><Square size={13}/>停止此项</button>}
      </div>
      <strong className="sf-ykt-video-name" title={task.name??undefined}>{task.name??"未命名资源"}</strong>
      <div className="sf-zhs-now-progress-row"><small>本地片段位置</small>
        <strong>{percent!=null?percent.toFixed(1)+"%":"—"}</strong></div>
      {percent!=null&&<div className="sf-verified-track sf-zhs-progress-track" role="progressbar"
        aria-label={(task.name??"此视频")+"本地片段位置"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{width:percent+"%"}}/>
      </div>}
      <small className="sf-muted">{task.state==="exited"?"进程已退出，学习记录待平台核验":
        task.state==="failed"?"退出码 "+(task.exit_code??"未知"):
        stale||task.stale?"暂无新采样":
        percent==null?(task.state==="queued"?"等待空闲位置":"等待进度采样"):"本地观测 · 非服务器完成进度"}</small>
    </article>;
  }
  return <section className="sf-ykt-live sf-zhs-queue" aria-label="知到同课视频任务">
    <div className="sf-ykt-live-title"><strong>同课视频 · {queue.concurrency} 路</strong>
      <small>{stale?"采样待同步":playing.length+" 项运行 · "+waiting.length+" 项排队"}</small></div>
    <div className="sf-ykt-worker-grid">{playing.map(row)}</div>
    {!playing.length&&status.state==="running"&&<p className="sf-muted">正在分配资源</p>}
    {waiting.length>0&&<details className="sf-ykt-video-details"><summary>等待队列 · {waiting.length} 项</summary>
      <div className="sf-ykt-worker-grid">{waiting.slice(0,100).map(row)}</div>
      {waiting.length>100&&<small>显示前 100 项，任务将自动补位。</small>}</details>}
    {ended.length>0&&<details className="sf-ykt-video-details"><summary>本轮记录 · {ended.length} 项</summary>
      <div className="sf-ykt-worker-grid">{ended.slice(-100).map(row)}</div></details>}
    {status.state==="exited"&&<p role="status">{legacyExitMessage(status)}</p>}
    {status.state==="exited"&&status.exit_code!==0&&status.diagnostic_code&&<p role="status">{zhsDiagnosticMessage(status)}</p>}
    {message&&<p role="status">{message}</p>}
    <small className="sf-muted">各视频独立运行，结束后自动补位。课程进度以服务器核验为准。</small>
  </section>;
}
