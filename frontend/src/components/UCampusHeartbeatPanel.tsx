import {useCallback,useEffect,useState} from "react";
import type {Course} from "../types";
import {request,friendlyBridgeError,type UCampusLocalStatus,type UCampusUnit,type UCampusSocketDiagnostic,type UCampusVerifiedProgress} from "../bridge";
import "./XuexitongHeartbeatPanel.css";

export function UCampusHeartbeatPanel({course,desktop}:{course:Course;desktop:boolean}){
  const [units,setUnits]=useState<UCampusUnit[]>([]);
  const [unitId,setUnitId]=useState("");
  const [pulses,setPulses]=useState(5);
  const [status,setStatus]=useState<UCampusLocalStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [socketBusy,setSocketBusy]=useState(false);
  const [socketDiagnostic,setSocketDiagnostic]=useState<UCampusSocketDiagnostic|null>(null);
  const [socketError,setSocketError]=useState("");
  const [serverBusy,setServerBusy]=useState(false);
  const [serverProgress,setServerProgress]=useState<UCampusVerifiedProgress|null>(null);
  const [previousProgress,setPreviousProgress]=useState<UCampusVerifiedProgress|null>(null);
  const [serverError,setServerError]=useState("");
  const courseId=course.course_id;
  const refresh=useCallback(async()=>{
    const state=await request<UCampusLocalStatus>({
      operation:"ucampus.heartbeat.status",course_id:courseId
    });
    if(state.course_id!==courseId)throw Error("INVALID_IPC_RESPONSE");
    setStatus(state);
  },[courseId]);
  useEffect(()=>{
    let live=true;
    setUnits([]);setUnitId("");setStatus(null);setMessage("");setServerProgress(null);setPreviousProgress(null);setServerError("");
    if(!desktop)return()=>{live=false;};
    void request<UCampusUnit[]>({operation:"ucampus.units.list",course_id:courseId})
      .then(value=>{
        if(!live)return;
        if(!Array.isArray(value))throw Error("INVALID_IPC_RESPONSE");
        setUnits(value);setUnitId(value[0]?.id??"");
      }).catch(error=>{if(live)setMessage(friendlyBridgeError(error));});
    void refresh().catch(error=>{if(live)setMessage(friendlyBridgeError(error));});
    if(typeof window==="undefined")return()=>{live=false;};
    const timer=window.setInterval(()=>{if(live)void refresh().catch(()=>{});},1500);
    return()=>{live=false;window.clearInterval(timer);};
  },[desktop,courseId,refresh]);

  const active=Boolean(status?.active);
  // Display-only progress for the local simulator. Never interpret it as
  // server learning credit or time watched.
  const targetPerResource=status?.pulses_per_resource??0;
  const localTotal=(status?.tasks.length??0)*targetPerResource;
  const localGenerated=Math.min(status?.generated??0,localTotal);
  const localPercent=localTotal>0?Math.round(localGenerated/localTotal*100):0;
  const newlyPassed=previousProgress&&serverProgress
    ? serverProgress.tasks.filter(task=>task.completed===true
        && previousProgress.tasks.some(previous=>previous.id===task.id&&previous.completed===false))
    : [];
  async function verifyServer(){
    if(!desktop||serverBusy||!unitId)return;
    setServerBusy(true);setServerError("");
    const baseline=serverProgress;
    try{
      const result=await request<UCampusVerifiedProgress>({
        operation:"ucampus.progress.verify",course_id:courseId,unit_id:unitId
      });
      if(result.course_id!==courseId||result.unit_id!==unitId||!Array.isArray(result.tasks))
        throw Error("INVALID_IPC_RESPONSE");
      setPreviousProgress(baseline&&baseline.unit_id===result.unit_id?baseline:null);
      setServerProgress(result);
    }catch(error){setServerError(friendlyBridgeError(error));}
    finally{setServerBusy(false);}
  }
  async function diagnoseSocket(){
    if(!desktop||socketBusy)return;
    setSocketBusy(true);setSocketDiagnostic(null);setSocketError("");
    try{
      const data=await request<UCampusSocketDiagnostic>({operation:"ucampus.socket.diagnose"});
      setSocketDiagnostic(data);
    }catch(error){setSocketError(friendlyBridgeError(error));}
    finally{setSocketBusy(false);}
  }
  async function control(action:"start"|"pause"|"resume"|"stop"){
    if(!desktop||busy)return;
    setBusy(true);setMessage("");
    try{
      if(action==="start"){
        if(!unitId||!Number.isInteger(pulses)||pulses<1||pulses>100)
          throw Error("UCAMPUS_INVALID_PARAMETER");
        await request<UCampusLocalStatus>({
          operation:"ucampus.heartbeat.start",
          course_id:courseId,unit_id:unitId,pulses
        });
      }else{
        if(!status?.run_id)throw Error("UCAMPUS_RUN_ID_MISMATCH");
        const operation=action==="pause"?"ucampus.heartbeat.pause":
          action==="resume"?"ucampus.heartbeat.resume":"ucampus.heartbeat.stop";
        await request<UCampusLocalStatus>({operation,course_id:courseId,run_id:status.run_id});
      }
      await refresh();
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(false);}
  }

  return <section className="sf-platform-settings-view sf-xxt-runtime" aria-label="U校园本地心跳练习模式">
    <div className="sf-xxt-section-heading">本地心跳练习模式 <span>仅在本机生成 · 不上传</span></div>
    <p className="sf-hint">使用学序<strong>本地自定义心跳生成器</strong>，不依赖官方播放器。
      目前是本机运行模式：U校园发送协议未验收，不会向平台发送，也不会显示已完成。</p>
    <div className="sf-settings-row">
      <div>
        <button type="button" className="secondary"
          disabled={!desktop||socketBusy}
          onClick={()=>void diagnoseSocket()}>
          {socketBusy?"正在检查旧版通道…":"检测旧版 WebSocket 通道"}
        </button>
        <p className="sf-muted">仅检查旧版 Socket.IO 连接和认证，不发送学习心跳。点击后将使用本机保存的 U校园会话发起一次官方服务器连接。</p>
        {socketDiagnostic&&<p role="status">
          握手通过 · 旧版命名空间已连接 · 已发送学习事件 {socketDiagnostic.learning_events_sent} 次 · U校园5.0 进度协议仍待核验
        </p>}
        {socketError&&<p role="alert">{socketError}</p>}
      </div>
    </div>
    <div className="sf-settings-row">
      <label>真实课程单元
        <select value={unitId} onChange={e=>{setUnitId(e.target.value);setServerProgress(null);setPreviousProgress(null);setServerError("");}}
          disabled={!desktop||active||busy}>
          <option value="">请选择</option>
          {units.map(unit=><option key={unit.id} value={unit.id}>{unit.title||unit.id}</option>)}
        </select>
      </label>
      <label>每个资源的本地心跳事件数
        <input type="number" min={1} max={100} step={1} value={pulses}
          disabled={active||busy}
          onChange={event=>setPulses(Number(event.target.value))}/>
      </label>
    </div>
    <div className="sf-actions actions">
      <button type="button" className="secondary"
        disabled={!desktop||serverBusy||!unitId} onClick={()=>void verifyServer()}>
        {serverBusy?"正在核验平台进度…":"核验 U校园服务器进度"}
      </button>
      <button type="button" className="primary" disabled={!desktop||busy||active||!unitId}
        onClick={()=>void control("start")}>开始本地心跳</button>
      <button type="button" className="secondary" disabled={!active||status?.paused||busy}
        onClick={()=>void control("pause")}>暂停</button>
      <button type="button" className="secondary" disabled={!active||!status?.paused||busy}
        onClick={()=>void control("resume")}>恢复</button>
      <button type="button" className="secondary" disabled={!active||busy}
        onClick={()=>void control("stop")}>停止</button>
      <button type="button" className="secondary" disabled={busy}
        onClick={()=>void refresh().catch(error=>setMessage(friendlyBridgeError(error)))}>刷新</button>
    </div>
    {message&&<p role="alert">{message}</p>}
    {serverError&&<p role="alert">{serverError}</p>}
    {serverProgress&&<div role="status" className="sf-xxt-evidence-note">
      <strong>服务器实际记录</strong>：
      已通过 {serverProgress.passed}/{serverProgress.total} 项，
      必修通过 {serverProgress.required_passed}/{serverProgress.required_total} 项；
      {serverProgress.unknown} 项状态未知。
      <p className="sf-muted">
        {serverProgress.verified_at} 核验 · 与本地心跳计数无关
      </p>
      {previousProgress&&<p className="sf-muted">
        相较上一次服务器核验：{newlyPassed.length} 项从未通过变为已通过。
        {newlyPassed.length>0&&` 资源：${newlyPassed.map(item=>item.id).join("、")}`}
        此变化仅代表服务器状态差异，不能推断由本地心跳引起。
      </p>}
      {!previousProgress&&<p className="sf-muted">
        已记录本次服务器状态为基准，下一次核验将显示差异。
      </p>}
    </div>}
    <div className="sf-xxt-evidence-note">
      <div className="sf-xxt-section-heading">本地模拟事件进度 <span>{localPercent}%</span></div>
      <progress aria-label="本地模拟事件进度" value={localGenerated} max={Math.max(localTotal,1)}
        style={{width:"100%"}}/>
      <p className="sf-muted">已生成 {status?.generated??0} / {localTotal} 个本地事件。此进度与视频播放、平台学时或课程完成状态无关。</p>
    </div>
    <dl className="sf-stat-grid">
      <div><dt>本地运行状态</dt><dd>{status?.phase||"尚未读取"}</dd></div>
      <div><dt>本地已生成</dt><dd>{status?.generated??0}</dd></div>
      <div><dt>实际发送</dt><dd>{status?.sent??0}</dd></div>
      <div><dt>平台确认</dt><dd>{status?.server_confirmed??"待核验"}</dd></div>
    </dl>
    <div className="sf-xxt-section-heading">任务记录 <span>{status?.tasks.length??0} 项</span></div>
    <div className="sf-xxt-table-scroll" role="region" aria-label="本地心跳任务列表" tabIndex={0}>
      <table className="sf-task-table">
        <thead><tr><th>资源</th><th>状态</th><th>本地生成</th><th>本地模拟进度</th><th>发送</th></tr></thead>
        <tbody>
          {(status?.tasks??[]).map(task=><tr key={task.resource_id}>
            <td>{task.title}</td><td>{task.state}</td>
            <td>{task.generated}</td>
            <td>
              <progress aria-label={`${task.title}本地事件进度`}
                value={Math.min(task.generated,targetPerResource)}
                max={Math.max(targetPerResource,1)} style={{width:"100%"}}/>
              <span className="sf-muted">{task.generated}/{targetPerResource}</span>
            </td>
            <td>{task.attempted}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}
