import {useCallback,useEffect,useState} from "react";
import type {Course} from "../types";
import {request,friendlyBridgeError,type UCampusFabricatedStatus,type UCampusUnit,type UCampusFabricatedHistory} from "../bridge";
import "./XuexitongHeartbeatPanel.css";

/** Experimental activity panel; remote status must not imply causality or actual viewing. */
export function UCampusFabricatedPanel({course,desktop}:{course:Course;desktop:boolean}){
  const [units,setUnits]=useState<UCampusUnit[]>([]);
  const [unitId,setUnitId]=useState("");
  const [pulses,setPulses]=useState(6);
  const [speed,setSpeed]=useState(1);
  const [duration,setDuration]=useState(600);
  const [interval,setInterval]=useState(20);
  const [instant,setInstant]=useState(false);
  const [status,setStatus]=useState<UCampusFabricatedStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [historyBusy,setHistoryBusy]=useState(false);
  const [history,setHistory]=useState<UCampusFabricatedHistory|null>(null);
  const courseId=course.course_id;
  const refresh=useCallback(async()=>{
    const state=await request<UCampusFabricatedStatus>({
      operation:"ucampus.fabricated.status",course_id:courseId
    });
    if(state.course_id!==courseId)throw Error("INVALID_IPC_RESPONSE");
    setStatus(state);
  },[courseId]);
  useEffect(()=>{
    let live=true;
    setUnits([]);setUnitId("");setStatus(null);setMessage("");setHistory(null);
    if(!desktop)return()=>{live=false;};
    void request<UCampusUnit[]>({operation:"ucampus.units.list",course_id:courseId})
      .then(value=>{
        if(!live)return;
        if(!Array.isArray(value))throw Error("INVALID_IPC_RESPONSE");
        setUnits(value);setUnitId(value[0]?.id??"");
      }).catch(error=>{if(live)setMessage(friendlyBridgeError(error));});
    void refresh().catch(()=>{});
    if(typeof window==="undefined")return()=>{live=false;};
    const timer=window.setInterval(()=>{if(live)void refresh().catch(()=>{});},1500);
    return()=>{live=false;window.clearInterval(timer);};
  },[desktop,courseId,refresh]);

  const active=Boolean(status?.active);
  async function loadHistory(){
    if(!desktop||historyBusy)return;
    setHistoryBusy(true);setMessage("");
    try{
      const snapshot=await request<UCampusFabricatedHistory>({
        operation:"ucampus.fabricated.history",course_id:courseId
      });
      if(!Array.isArray(snapshot.records)||snapshot.resume_available!==false)
        throw Error("INVALID_IPC_RESPONSE");
      setHistory(snapshot);
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setHistoryBusy(false);}
  }
  async function control(action:"start"|"pause"|"resume"|"stop"){
    if(!desktop||busy)return;
    setBusy(true);setMessage("");
    try{
      if(action==="start"){
        if(!unitId||!Number.isInteger(pulses)||pulses<1||pulses>100
          ||!Number.isFinite(speed)||speed<0.25||speed>16
          ||!Number.isFinite(duration)||duration<1||duration>36000
          ||!Number.isFinite(interval)||interval<0.01||interval>3600)
          throw Error("UCAMPUS_INVALID_FABRICATED_PARAMETER");
        await request<UCampusFabricatedStatus>({
          operation:"ucampus.fabricated.start",
          course_id:courseId,unit_id:unitId,pulses,speed,
          duration_seconds:duration,heartbeat_interval:interval,
          instant_complete:instant
        });
      }else{
        if(!status?.run_id)throw Error("UCAMPUS_RUN_ID_MISMATCH");
        const operation=action==="pause"?"ucampus.fabricated.pause":
          action==="resume"?"ucampus.fabricated.resume":"ucampus.fabricated.stop";
        await request<UCampusFabricatedStatus>({
          operation,course_id:courseId,run_id:status.run_id
        });
      }
      await refresh();
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(false);}
  }

  return <section className="sf-platform-settings-view sf-xxt-runtime" aria-label="U校园虚构心跳刷完成">
    <div className="sf-xxt-section-heading">实验性虚构事件模块 <span>模拟记录 · 非正式验收</span></div>
    <p className="sf-muted">本模块独立于上方“本地练习模式”。它包含远端写入请求，且未通过 U校园5.0 真实账号验收；请勿把模拟进度视为实际学习记录。</p>
    <p className="sf-hint">不打开官方播放器、不解码视频：本机按虚拟播放位置递增生成心跳，
      中间包走本地 Socket.IO 活动事件，末包按上游 <code>submitType=2</code> 申报完成，
      再只读回读 <code>course_progress</code> 的 <code>pass</code> 标记确认。
      <strong>“已申报”只是响应分类；“回读已通过”仅表示读取时服务器状态，不证明本次事件造成该结果。</strong></p>
    <div className="sf-settings-row">
      <label>真实课程单元
        <select value={unitId} onChange={e=>setUnitId(e.target.value)}
          disabled={!desktop||active||busy}>
          <option value="">请选择</option>
          {units.map(unit=><option key={unit.id} value={unit.id}>{unit.title||unit.id}</option>)}
        </select>
      </label>
      <label>心跳包数
        <input type="number" min={1} max={100} step={1} value={pulses}
          disabled={active||busy||instant}
          onChange={e=>setPulses(Number(e.target.value))}/>
      </label>
      <label>虚构时长（秒/资源）
        <input type="number" min={1} max={36000} step={1} value={duration}
          disabled={active||busy}
          onChange={e=>setDuration(Number(e.target.value))}/>
      </label>
      <label>本地倍速
        <input type="number" min={0.25} max={16} step={0.25} value={speed}
          disabled={active||busy}
          onChange={e=>setSpeed(Number(e.target.value))}/>
      </label>
      <label>心跳间隔（秒）
        <input type="number" min={0.01} max={3600} step={1} value={interval}
          disabled={active||busy||instant}
          onChange={e=>setInterval(Number(e.target.value))}/>
      </label>
      <label>直接申报完成
        <input type="checkbox" checked={instant} disabled={active||busy}
          onChange={e=>setInstant(e.target.checked)}/>
      </label>
    </div>
    <p className="sf-muted">暂停后的“恢复”只适用于当前运行进程；状态快照不代表应用重启后能断点续传，也不证明平台认可观看进度。</p>
    <div className="sf-actions actions">
      <button type="button" className="primary" disabled={!desktop||busy||active||!unitId}
        onClick={()=>void control("start")}>开始虚构刷完成</button>
      <button type="button" className="secondary" disabled={!active||status?.paused||busy}
        onClick={()=>void control("pause")}>暂停</button>
      <button type="button" className="secondary" disabled={!active||!status?.paused||busy}
        onClick={()=>void control("resume")}>恢复</button>
      <button type="button" className="secondary" disabled={!active||busy}
        onClick={()=>void control("stop")}>停止</button>
      <button type="button" className="secondary" disabled={busy}
        onClick={()=>void refresh().catch(error=>setMessage(friendlyBridgeError(error)))}>刷新</button>
      <button type="button" className="secondary" disabled={!desktop||historyBusy}
        onClick={()=>void loadHistory()}>
        {historyBusy?"正在读取历史…":"查看本地历史快照"}
      </button>
    </div>
    {message&&<p role="alert">{message}</p>}
    {status?.last_error&&<p role="alert">{friendlyBridgeError(new Error(status.last_error))}</p>}
    <dl className="sf-stat-grid">
      <div><dt>运行状态</dt><dd>{status?.phase||"尚未读取"}</dd></div>
      <div><dt>本地生成</dt><dd>{status?.generated??0}</dd></div>
      <div><dt>发送帧/尝试次数</dt><dd>{status?.sent??0}</dd></div>
      <div><dt>已申报（code=0）</dt><dd>{status?.transport_accepted??0}</dd></div>
      <div><dt>回读已通过（归因未知）</dt><dd>{status?.server_confirmed??0}</dd></div>
      <div><dt>通道已连接</dt><dd>{status?.sender_connected?"是":"否"}</dd></div>
      <div><dt>重启后自动续跑</dt><dd>不支持</dd></div>
    </dl>
    {history&&<div className="sf-xxt-evidence-note">
      <strong>本地历史快照（只读）</strong>
      <p className="sf-muted">重启后可查看此前的任务计数；不会自动续发或补交模拟事件。</p>
      {history.records.length===0&&<p className="sf-muted">当前课程暂无已保存的本地任务快照。</p>}
      <ul>{history.records.map(record=><li key={record.run_id}>
        {record.unit_id||"未知单元"} · {record.phase} ·
        本地生成 {record.generated} · 曾尝试发送 {record.sent} ·
        回读已通过 {record.server_readback_passed}（归因未知）
      </li>)}</ul>
    </div>}
    <div className="sf-xxt-section-heading">资源记录 <span>{status?.tasks.length??0} 项</span></div>
    <div className="sf-xxt-table-scroll" role="region" aria-label="虚构心跳资源列表" tabIndex={0}>
      <table className="sf-task-table">
        <thead><tr><th>资源</th><th>类型</th><th>状态</th><th>虚拟位置/时长</th><th>生成</th><th>发送</th></tr></thead>
        <tbody>
          {(status?.tasks??[]).map(task=><tr key={task.resource_id}>
            <td>{task.title||task.resource_id}</td>
            <td>{task.dtype}</td>
            <td>{task.state}</td>
            <td>{task.position_seconds} / {task.duration_seconds}s</td>
            <td>{task.generated}</td>
            <td>{task.sent}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}
