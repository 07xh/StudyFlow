import {useEffect,useRef,useState} from "react";
import type {Course} from "../types";
import {request,friendlyBridgeError,type UCampusUnit,type UCampusSocketDiagnostic,type UCampusVerifiedProgress} from "../bridge";
import "./XuexitongHeartbeatPanel.css";

/** Read-only U校园 server progress. No local heartbeat runner or event upload. */
export function UCampusProgressVerifyPanel({course,desktop}:{course:Course;desktop:boolean}){
  const courseId=course.course_id;
  const [units,setUnits]=useState<UCampusUnit[]>([]);
  const [unitId,setUnitId]=useState("");
  const [unitsError,setUnitsError]=useState("");
  const [unitsBusy,setUnitsBusy]=useState(false);
  const [serverBusy,setServerBusy]=useState(false);
  const [serverProgress,setServerProgress]=useState<UCampusVerifiedProgress|null>(null);
  const [previousProgress,setPreviousProgress]=useState<UCampusVerifiedProgress|null>(null);
  const [serverError,setServerError]=useState("");
  const [socketBusy,setSocketBusy]=useState(false);
  const [socketDiagnostic,setSocketDiagnostic]=useState<UCampusSocketDiagnostic|null>(null);
  const [socketError,setSocketError]=useState("");
  const verificationToken=useRef(0);

  useEffect(()=>{
    let active=true;
    verificationToken.current++;
    setUnits([]);setUnitId("");setUnitsError("");setUnitsBusy(false);
    setServerBusy(false);setServerProgress(null);setPreviousProgress(null);setServerError("");
    setSocketDiagnostic(null);setSocketError("");setSocketBusy(false);
    if(!desktop)return()=>{active=false;verificationToken.current++;};
    setUnitsBusy(true);
    void request<UCampusUnit[]>({operation:"ucampus.units.list",course_id:courseId})
      .then(value=>{
        if(!active)return;
        if(!Array.isArray(value))throw Error("INVALID_IPC_RESPONSE");
        setUnits(value);setUnitId(value[0]?.id??"");
      })
      .catch(error=>{if(active)setUnitsError(friendlyBridgeError(error));})
      .finally(()=>{if(active)setUnitsBusy(false);});
    return()=>{active=false;verificationToken.current++;};
  },[courseId,desktop]);

  const newlyPassed=previousProgress&&serverProgress
    ? serverProgress.tasks.filter(task=>task.completed===true
        && previousProgress.tasks.some(previous=>previous.id===task.id&&previous.completed===false))
    : [];

  async function verifyServer(){
    if(!desktop||serverBusy||!unitId)return;
    const token=++verificationToken.current;
    const baseline=serverProgress?.unit_id===unitId?serverProgress:null;
    setServerBusy(true);setServerError("");
    try{
      const result=await request<UCampusVerifiedProgress>({
        operation:"ucampus.progress.verify",course_id:courseId,unit_id:unitId
      });
      if(token!==verificationToken.current)return;
      if(result.course_id!==courseId||result.unit_id!==unitId||!Array.isArray(result.tasks))
        throw Error("INVALID_IPC_RESPONSE");
      setPreviousProgress(baseline);
      setServerProgress(result);
    }catch(error){
      if(token===verificationToken.current)setServerError(friendlyBridgeError(error));
    }finally{
      if(token===verificationToken.current)setServerBusy(false);
    }
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

  return <section className="sf-platform-settings-view sf-xxt-runtime" aria-label="U校园服务器只读核验">
    <div className="sf-xxt-section-heading">服务器进度核验 <span>只读 · 不发送学习事件</span></div>
    <p className="sf-muted">读取当前课程真实单元的服务器通过状态；核验结果与本地模拟事件无关，也不证明进度变化的原因。</p>
    <div className="sf-settings-row">
      <label>课程单元
        <select value={unitId} disabled={!desktop||unitsBusy}
          onChange={e=>{
            verificationToken.current++;
            setUnitId(e.target.value);setServerProgress(null);setPreviousProgress(null);
            setServerError("");setServerBusy(false);
          }}>
          <option value="">请选择</option>
          {units.map(unit=><option key={unit.id} value={unit.id}>{unit.title||unit.id}</option>)}
        </select>
      </label>
      <button type="button" className="secondary"
        disabled={!desktop||unitsBusy||serverBusy||!unitId}
        onClick={()=>void verifyServer()}>
        {serverBusy?"正在核验服务器进度…":"核验服务器进度"}
      </button>
    </div>
    {unitsBusy&&<p role="status">正在读取真实课程单元…</p>}
    {unitsError&&<p role="alert">{unitsError}</p>}
    {!unitsBusy&&!unitsError&&units.length===0&&<p className="sf-muted">暂无可核验的课程单元。</p>}
    {serverError&&<p role="alert">{serverError}</p>}
    {serverProgress&&<div role="status" className="sf-xxt-evidence-note">
      <strong>服务器实际记录</strong>：
      已通过 {serverProgress.passed}/{serverProgress.total} 项，
      必修通过 {serverProgress.required_passed}/{serverProgress.required_total} 项；
      {serverProgress.unknown} 项状态未知。
      <p className="sf-muted">{serverProgress.verified_at} 核验 · 只读服务器快照</p>
      {previousProgress?<p className="sf-muted">
        相较上一次服务器核验：{newlyPassed.length} 项从未通过变为已通过。
        {newlyPassed.length>0&&<> 资源：{newlyPassed.map(item=>item.id).join("、")}</>}
        此变化仅代表服务器状态差异，不能推断由某次本地事件引起。
      </p>:<p className="sf-muted">已记录本次服务器状态为基准，下一次核验将显示差异。</p>}
      <div className="sf-xxt-section-heading">资源通过状态 <span>{serverProgress.tasks.length} 项</span></div>
      <ul className="sf-xxt-task-list">
        {serverProgress.tasks.map(task=><li className="sf-xxt-task-item" key={task.id}>
          <strong>{task.id}</strong>
          <span className={"sf-xxt-state "+(task.completed===true?"completed":task.completed===false?"pending":"unknown")}>
            {task.completed===true?"已通过":task.completed===false?"未通过":"待核验"}
          </span>
          <small>{task.required===true?"必修":task.required===false?"非必修":"必修状态未知"}</small>
        </li>)}
      </ul>
    </div>}
    <details className="sf-xxt-evidence-note">
      <summary>旧版连接诊断（不提交学习事件）</summary>
      <p className="sf-muted">只检测旧版 Socket.IO 认证与连接，不代表 U校园5.0 的进度协议兼容或学习完成。</p>
      <button type="button" className="secondary" disabled={!desktop||socketBusy}
        onClick={()=>void diagnoseSocket()}>
        {socketBusy?"正在检查旧版连接…":"检测旧版 WebSocket 连接"}
      </button>
      {socketDiagnostic&&<p role="status">
        旧版命名空间已连接 · 已发送学习事件 {socketDiagnostic.learning_events_sent} 次 · AI5.0 兼容性未验证
      </p>}
      {socketError&&<p role="alert">{socketError}</p>}
    </details>
  </section>;
}
