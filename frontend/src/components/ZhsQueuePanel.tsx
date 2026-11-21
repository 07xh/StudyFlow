import {useEffect,useRef,useState} from "react";
import {Square} from "lucide-react";
import {stopZhsVideo,legacyError,legacyExitMessage,zhsDiagnosticMessage,type LegacyTaskStatus} from "../legacyPlayback";
import {friendlyBridgeError,request,type ZhsKnowledgeDetail} from "../bridge";

const labels:Record<string,string>={queued:"排队中",running:"运行中",exited:"本轮结束 · 待核验",
  failed:"执行失败",unconfirmed:"服务器未确认",stopped:"已停止",informational:"只有详情 · 暂无可执行资源",unknown:"状态待核实"};
const kinds={video:"视频",ppt:"PPT",article:"文章",other:"其他资源",detail:"无资源知识点"};
const requirementLabels:Record<string,string>={required:"必学",optional:"选学",unknown:"分类待核验",shared:"共享课"};
export function ZhsQueuePanel({status,unavailable=false,onRefresh}:{
  status:LegacyTaskStatus;unavailable?:boolean;onRefresh:()=>Promise<void>;
}){
  const [requested,setRequested]=useState<Set<string>>(new Set());
  const [message,setMessage]=useState("");
  const [detail,setDetail]=useState<ZhsKnowledgeDetail|null>(null);
  const [detailBusy,setDetailBusy]=useState(false);
  const [detailMessage,setDetailMessage]=useState("");
  const currentRun=useRef(status.run_id);
  currentRun.current=status.run_id;
  useEffect(()=>{
    setRequested(new Set());setMessage("");
    setDetail(null);setDetailMessage("");setDetailBusy(false);
  },[status.run_id]);
  const queue=status.zhs_queue;
  if(!queue)return null;
  const stale=unavailable||queue.stale;
  const active=status.state==="running"&&!stale;
  const playing=queue.tasks.filter(t=>t.state==="running");
  const waiting=queue.tasks.filter(t=>t.state==="queued");
  const ended=queue.tasks.filter(t=>t.state!=="queued"&&t.state!=="running");
  const failed=ended.filter(t=>t.state==="failed");
  const unconfirmed=ended.filter(t=>t.state==="unconfirmed");
  const stopped=ended.filter(t=>t.state==="stopped");
  const informational=ended.filter(t=>t.state==="informational");
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
  async function inspectDetail(knowledgeId:number){
    const courseKey=status.course_id;
    const run=status.run_id;
    if(!courseKey||!Number.isSafeInteger(knowledgeId)||knowledgeId<=0)return;
    setDetailBusy(true);setDetailMessage("");
    try{
      const result=await request<ZhsKnowledgeDetail>({
        operation:"zhidao.zhs.knowledge.detail",course_key:courseKey,knowledge_id:knowledgeId
      });
      if(run!==currentRun.current)return;
      if(result.course_key!==courseKey||result.knowledge_id!==knowledgeId||
          result.verification!=="read_only"){
        throw new Error("ZHS_DETAIL_UNAVAILABLE");
      }
      setDetail(result);
    }catch(error){
      if(run!==currentRun.current)return;
      setDetail(null);
      setDetailMessage("知识点详情读取失败："+friendlyBridgeError(error));
    }finally{
      if(run===currentRun.current)setDetailBusy(false);
    }
  }
  type Row=NonNullable<LegacyTaskStatus["zhs_queue"]>["tasks"][number];
  function row(task:Row){
    const inProgress=task.state==="queued"||task.state==="running";
    const pendingStop=active&&inProgress&&requested.has(task.task_id);
    const percent=!stale&&!task.stale&&task.kind==="video"&&task.state==="running"&&
      task.playback_phase!=="paused"&&task.playback_phase!=="answering"?task.percent:null;
    const phaseLabel=task.playback_phase==="paused"?"播放暂停":task.playback_phase==="answering"?"处理题目":null;
    return <article className="sf-ykt-worker" key={task.task_id}>
      <div className="sf-ykt-worker-heading">
        <span>{kinds[task.kind]}{task.requirement&&" · "+requirementLabels[task.requirement]} · {stale&&inProgress?"状态待核实":pendingStop?"正在停止":task.state==="running"&&phaseLabel?phaseLabel:labels[task.state]}</span>
        {inProgress&&<button type="button" className="secondary" aria-label={"停止"+(task.name??"此资源")}
          disabled={!active||pendingStop} onClick={()=>void stop(task.task_id)}><Square size={13}/>停止此项</button>}
      </div>
      <strong className="sf-ykt-video-name" title={task.name??undefined}>{task.name??"未命名资源"}</strong>
      {task.kind==="detail"&&task.knowledge_id!=null&&<button
        type="button" className="secondary" disabled={detailBusy||!status.course_id}
        onClick={()=>void inspectDetail(task.knowledge_id!)}>
        {detailBusy?"读取中…":"读取知识点详情与服务器资源状态"}
      </button>}
      {task.kind!=="detail"&&<div className="sf-zhs-now-progress-row"><small>本地片段位置</small>
        <strong>{percent!=null?percent.toFixed(1)+"%":"—"}</strong></div>}
      {task.state==="running"&&<div
        className={"sf-verified-track sf-zhs-progress-track"+(percent==null?" is-unverified":"")}
        role="progressbar"
        aria-label={(task.name??"此视频")+"本地片段位置"}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent??undefined}
        aria-valuetext={percent==null?"等待当前资源的有效进度采样":percent.toFixed(1)+"%"}>
        <span style={{width:percent!=null?percent+"%":"0%"}}/>
      </div>}
      <small className="sf-muted">{task.state==="informational"?"目录中可识别此知识点，但本次资源列表为空。可能只有详情内容或课程尚在建设；未启动原版发送器，也未提交或确认学习记录。":
        task.state==="exited"?"进程已退出，学习记录待平台核验":
        task.state==="unconfirmed"?(task.exit_code===16?"服务器回读状态未增加，未认定任务已完成":"服务器暂不可核验，尚不能确认写入"):
        task.state==="failed"?"退出码 "+(task.exit_code??"未知"):
        stale?"队列状态暂不可用 · 请重新读取任务状态":
        task.state==="running"&&task.kind!=="video"?"非视频资源 · 不提供视频位置百分比":
        task.stale?"视频采样中断或一直没有有效数值；是否仍在播放尚需核对运行状态":
        task.playback_phase==="paused"?"检测到原程序处于暂停阶段；不将暂停计时当作播放进度":
        task.playback_phase==="answering"?"检测到原程序正在处理题目；当前没有有效播放进度采样":
        percent==null?(task.state==="queued"?"等待本章节的上一资源结束":"正在等待本视频的有效采样"):"本地观测 · 非服务器完成进度"}</small>
    </article>;
  }
  function grouped(rows:Row[]){
    const groups=new Map<string,{label:string;items:Row[]}>();
    for(const item of rows){
      const key=item.chapter_key||item.task_id;
      const label=item.chapter_name||"未识别章节";
      const previous=groups.get(key);
      if(previous)previous.items.push(item);
      else groups.set(key,{label,items:[item]});
    }
    return [...groups.entries()].map(([key,group])=>
      <section className="sf-zhs-chapter-lane" key={key} aria-label={group.label}>
        <div className="sf-zhs-chapter-heading"><strong>{group.label}</strong>
          <small>{group.items.length} 项</small></div>
        <div className="sf-ykt-worker-grid">{group.items.map(row)}</div>
      </section>);
  }
  return <section className="sf-ykt-live sf-zhs-queue" aria-label="知到同课章节任务">
    <div className="sf-ykt-live-title"><strong>章节并行 · {queue.concurrency} 路</strong>
      <small>{stale?"采样待同步":playing.length+" 项运行 · "+waiting.length+" 项排队"}</small></div>
    {grouped(playing)}
    {!playing.length&&status.state==="running"&&<div className="sf-task-context" role="status">
      <span>{waiting.length?("正在分配下一项"+(waiting[0]?.chapter_name?" · "+waiting[0].chapter_name:"")+
        "，等待实际资源启动"):"正在等待任务最终状态"}</span>
      <div className="sf-verified-track sf-zhs-progress-track is-indeterminate" role="progressbar"
        aria-label="章节任务切换中" aria-valuemin={0} aria-valuemax={100}
        aria-valuetext="暂无下一资源的有效播放进度"><span style={{width:"0%"}}/></div>
    </div>}
    {waiting.length>0&&<details className="sf-ykt-video-details"><summary>等待队列 · {waiting.length} 项</summary>
      {grouped(waiting.slice(0,100))}
      {waiting.length>100&&<small>显示前 100 项，任务将自动补位。</small>}</details>}
    {detail&&<section className="sf-task-context" aria-label="ZHS 知识点详情（只读）">
      <div className="sf-ykt-worker-heading">
        <strong>{detail.name} · 服务器只读</strong>
        <button className="secondary" type="button" onClick={()=>setDetail(null)}>收起详情</button>
      </div>
      <p>知识点进度：{detail.knowledge_progress_percent}% ·
        平台目录资源：{detail.official_resource_count==null?"未提供":detail.official_resource_count} ·
        已完成资源：{detail.official_finished_resource_count==null?"未提供":detail.official_finished_resource_count}</p>
      {detail.catalog_mismatch&&<p role="status">资源目录与 ZHS 返回数量不一致；本次不能认定无资源。</p>}
      {detail.official_resource_count===0&&<p>官方目录记录为 0 项资源。这类知识点没有可调用的视频/PPT 资源心跳，不能凭打开详情就标记学习完成。</p>}
      <div style={{whiteSpace:"pre-wrap",maxHeight:320,overflowY:"auto"}}>
        {detail.content_available?detail.content:"官方知识点接口未提供可展示的正文；请在知到原页面查看完整详情。"}
      </div>
      <small className="sf-muted">本页面只读，不发送学习心跳或完成请求；进度来自真实课程服务器记录。</small>
    </section>}
    {detailMessage&&<p role="status" className="sf-muted">{detailMessage}</p>}
    {informational.length>0&&<p role="status" className="sf-muted">
      已识别 {informational.length} 个仅含详情、没有可执行资源的知识点；这些项目只作目录提示，不会伪造资源 ID 或学习完成结果。请在官方详情页核实内容与建设状态。
    </p>}
    {(failed.length>0||unconfirmed.length>0||stopped.length>0)&&<p role="status" className="sf-muted">
      本轮异常记录：执行失败 {failed.length} 项、服务器未确认 {unconfirmed.length} 项、已停止 {stopped.length} 项。单个视频失败不代表其他视频已完成；若启用了遇错停止，其余运行项也可能提前结束。
      {[...unconfirmed,...failed].slice(0,3).map(item=><span key={item.task_id}> {item.name??"未命名资源"}（退出码 {item.exit_code??"未知"}）</span>)}
    </p>}
    {ended.length>0&&<details className="sf-ykt-video-details"><summary>本轮记录 · {ended.length} 项</summary>
      {grouped(ended.slice(-100))}</details>}
    {status.state==="exited"&&<p role="status">{legacyExitMessage(status)}</p>}
    {status.state==="exited"&&status.exit_code!==0&&status.diagnostic_code&&<p role="status">{zhsDiagnosticMessage(status)}</p>}
    {message&&<p role="status">{message}</p>}
    <small className="sf-muted">同一章节按视频、文章和 PPT 的原顺序逐项执行，不同章节独立占用运行路数；不足多个可执行章节时不会强行凑满并发。课程进度以服务器核验为准。</small>
  </section>;
}
