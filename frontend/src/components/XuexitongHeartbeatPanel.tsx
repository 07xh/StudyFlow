// 统一 UI 内的学习通本地心跳任务面板。不新建窗口、不新建平台导航，
// 只通过 frontend/src/bridge.ts 的统一 IPC 调用 Sidecar 长驻服务。
// 合入前先应用 docs/XUEXITONG_HEARTBEAT_INTEGRATION.md 的 bridge.ts 类型补丁。
// 合入位置：frontend/src/components/XuexitongHeartbeatPanel.tsx
import {useCallback,useEffect,useRef,useState} from "react";
import type {Course} from "../types";
import {friendlyBridgeError,request,type XuexitongSettings} from "../bridge";

export type HeartbeatTaskView={
  task_id:string;run_id:string;course_key:string;chapter:string;title:string;
  state:string;playing_time:number;duration:number;speed:number;
  last_send_state:string;sent_count:number;server_confirmed:boolean;
  server_play_time:number;end_reason:string;confirmed:boolean;resumable:boolean;
};

export type HeartbeatStatus={
  ok:boolean;running:boolean;paused:boolean;run_id:string;course_key:string;
  config:{speed:number;jobs:number;instant_complete:boolean;randomize_interval:boolean};
  task_count:number;tasks:HeartbeatTaskView[];
  heartbeats:{sent:number;server_confirmed:number};
  queue_controls:{pause:boolean;resume:boolean;stop:boolean};
};

export type HeartbeatLog={event:string;at:number;[key:string]:unknown};

const stateLabels:Record<string,string>={
  pending:"等待中",running:"运行中",paused:"已暂停",succeeded:"服务端已确认",
  failed:"失败",stopped:"已停止",interrupted:"中断待续"
};

const sendLabels:Record<string,string>={
  confirmed:"服务端确认",reported:"已发出未确认",forbidden:"风控拒绝(403)",
  captcha:"触发验证码",session_expired:"会话失效",protocol_error:"响应异常",
  http_error:"HTTP 错误",network_error:"网络异常",invalid_target:"参数无效","":"尚未发送"
};

export function XuexitongHeartbeatPanel({course,desktop}:{
  course:Course;desktop:boolean;
}){
  const [speed,setSpeed]=useState(1);
  const [jobs,setJobs]=useState(2);
  const [instant,setInstant]=useState(true);
  const [mediaType,setMediaType]=useState<"all"|"Video"|"Audio">("all");
  const [status,setStatus]=useState<HeartbeatStatus|null>(null);
  const [logs,setLogs]=useState<HeartbeatLog[]>([]);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const timer=useRef<number|null>(null);
  const refreshInFlight=useRef(false);
  const selectedCourse=useRef(course.course_id);
  selectedCourse.current=course.course_id;

  const refresh=useCallback(async()=>{
    if(refreshInFlight.current)return;
    refreshInFlight.current=true;
    try{
      const [nextStatus,nextLogs]=await Promise.all([
        request<HeartbeatStatus>({operation:"xuexitong.heartbeat.status",course_id:course.course_id}),
        request<{ok:boolean;events:HeartbeatLog[]}>({operation:"xuexitong.heartbeat.logs",limit:30,course_id:course.course_id}),
      ]);
      if(selectedCourse.current!==course.course_id)return;
      if(nextStatus.course_key===course.course_id){
        setStatus(nextStatus);
        setLogs(nextStatus.run_id?(nextLogs.events||[]).filter(entry=>entry.run_id===nextStatus.run_id):[]);
      }
    }catch(error){
      if(selectedCourse.current===course.course_id)setMessage(friendlyBridgeError(error));
    }finally{refreshInFlight.current=false;}
  },[course.course_id]);

  useEffect(()=>{
    setStatus(null);setLogs([]);setMessage("");
    void refresh();
    // React's Node-based test renderer has no window. The desktop app does.
    if(typeof window==="undefined")return;
    timer.current=window.setInterval(()=>{void refresh();},2000);
    return ()=>{
      if(timer.current!==null){
        window.clearInterval(timer.current);
        timer.current=null;
      }
    };
  },[refresh]);

  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    void request<XuexitongSettings>({operation:"xuexitong.settings.get"})
      .then(settings=>{
        if(active){setSpeed(settings.playback_speed);setJobs(settings.concurrency);}
      }).catch(()=>{});
    return ()=>{active=false;};
  },[desktop]);

  const validConfig=Number.isFinite(speed)&&speed>=0.25&&speed<=2
    &&Number.isInteger(jobs)&&jobs>=1&&jobs<=4;
  // Do not expose controls for a previous course during navigation.
  const currentStatus=status?.course_key===course.course_id?status:null;
  const control=async(action:"start"|"pause"|"resume"|"stop")=>{
    if(busy||!desktop)return;
    const actionCourse=course.course_id;
    setBusy(true);setMessage("");
    try{
      if(action==="start"){
        if(!validConfig)throw new Error("请输入有效的速度（0.25–2）与章节并发数（1–4）。");
        // Reuse the same validated settings contract as the platform settings page.
        // Only saved speed/concurrency are updated; verification preferences survive.
        const defaults=await request<XuexitongSettings>({operation:"xuexitong.settings.get"});
        await request<XuexitongSettings>({
          operation:"xuexitong.settings.save",
          settings:{...defaults,playback_speed:speed,concurrency:jobs},
        });
        await request<{ok:boolean;run_id:string}>({
          operation:"xuexitong.heartbeat.start",course_id:actionCourse,
          speed,jobs,instant_complete:instant,
          ...(mediaType!=="all"?{dtype:mediaType}:{}),
        });
        if(selectedCourse.current===actionCourse)setMessage("本地任务已启动，实际完成状态以平台核验为准。");
      }else{
        const runId=currentStatus?.run_id;
        if(!runId)throw new Error("XUEXITONG_RUN_ID_REQUIRED");
        if(action==="pause"){
          await request<{ok:boolean}>({operation:"xuexitong.heartbeat.pause",run_id:runId});
        }else if(action==="resume"){
          await request<{ok:boolean}>({operation:"xuexitong.heartbeat.resume",run_id:runId});
        }else{
          await request<{ok:boolean}>({operation:"xuexitong.heartbeat.stop",run_id:runId});
        }
      }
      await refresh();
    }catch(error){
      if(selectedCourse.current===actionCourse)setMessage(friendlyBridgeError(error));
    }finally{setBusy(false);}
  };

  const running=Boolean(currentStatus?.running);
  const paused=Boolean(currentStatus?.paused);
  const tasks=currentStatus?.tasks||[];
  const controls=currentStatus?.queue_controls;

  return <section className="sf-platform-settings-view" aria-label="学习通本地心跳任务">
    <p className="sf-hint">
      本地任务记录与平台核验分别统计；未经确认的任务不显示为已完成。速度、并发在启动时保存；其他选项仅本次生效。
    </p>

    <div className="sf-settings-row">
      <label>速度
        <input type="number" min={0.25} max={2} step={0.25} value={speed}
          disabled={running||busy||!desktop}
          onChange={event=>setSpeed(Number(event.target.value))}/>
      </label>
      <label>并发章节
        <input type="number" min={1} max={4} step={1} value={jobs}
          disabled={running||busy||!desktop}
          onChange={event=>setJobs(Number(event.target.value))}/>
      </label>
      <label>任务类型
        <select value={mediaType} disabled={running||busy||!desktop}
          onChange={event=>setMediaType(event.target.value as "all"|"Video"|"Audio")}>
          <option value="all">视频 + 音频</option>
          <option value="Video">仅视频</option>
          <option value="Audio">仅音频</option>
        </select>
      </label>
      <label className="sf-check">
        <input type="checkbox" checked={instant} disabled={running||busy||!desktop}
          onChange={event=>setInstant(event.target.checked)}/>
        首包申报整段完成
      </label>
    </div>

    <div className="sf-actions">
      <button type="button" disabled={busy||!desktop||running||!validConfig} onClick={()=>void control("start")}>开始</button>
      <button type="button" disabled={busy||!desktop||!controls?.pause} onClick={()=>void control("pause")}>暂停</button>
      <button type="button" disabled={busy||!desktop||!controls?.resume} onClick={()=>void control("resume")}>继续</button>
      <button type="button" disabled={busy||!desktop||!controls?.stop} onClick={()=>void control("stop")}>停止</button>
      <button type="button" disabled={busy} onClick={()=>void refresh()}>刷新</button>
    </div>

    {message?<p className="sf-message">{message}</p>:null}

    <dl className="sf-stat-grid">
      <div><dt>运行状态</dt><dd>{!currentStatus?"尚未读取":running?(paused?"已暂停":"运行中"):tasks.length?"历史记录（未运行）":"空闲"}</dd></div>
      <div><dt>本地已申报</dt><dd>{currentStatus?.heartbeats.sent??0}</dd></div>
      <div><dt>服务端确认</dt><dd>{currentStatus?.heartbeats.server_confirmed??0}</dd></div>
      <div><dt>任务数</dt><dd>{currentStatus?.task_count??0}</dd></div>
      <div><dt>运行 ID</dt><dd>{currentStatus?.run_id||"—"}</dd></div>
      <div><dt>当前配置</dt><dd>{running&&currentStatus?`${currentStatus.config.speed}x / ${currentStatus.config.jobs} 并发`:"—"}</dd></div>
    </dl>

    <table className="sf-task-table" aria-label="心跳任务状态">
      <thead><tr><th>任务</th><th>状态</th><th>本地记录（非播放证明）</th><th>服务端进度</th><th>最近一次请求</th></tr></thead>
      <tbody>
        {tasks.length===0?<tr><td colSpan={5}>暂无任务记录</td></tr>:tasks.map(task=>
          <tr key={task.task_id}>
            <td>{task.title||task.task_id}</td>
            <td>{stateLabels[task.state]||task.state}</td>
            <td>{task.playing_time}/{task.duration}s（{task.sent_count} 次）</td>
            <td>{task.server_confirmed?"已确认":"未确认"}{task.server_play_time?` · ${task.server_play_time}s`:""}</td>
            <td>{sendLabels[task.last_send_state]||task.last_send_state}</td>
          </tr>)}
      </tbody>
    </table>

    <details>
      <summary>运行日志（最近 {logs.length} 条）</summary>
      <ul className="sf-log-list">
        {logs.map((entry,index)=><li key={`${entry.event}-${entry.at}-${index}`}>
          {entry.event}{entry.end_reason?` · ${String(entry.end_reason)}`:""}
          {entry.state?` · ${String(entry.state)}`:""}
        </li>)}
      </ul>
    </details>
  </section>;
}
