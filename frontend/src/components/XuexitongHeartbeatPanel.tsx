// 统一 UI 内的学习通本地心跳任务面板。不新建窗口、不新建平台导航，
// 只通过 frontend/src/bridge.ts 的统一 IPC 调用 Sidecar 长驻服务。
// 合入前先应用 docs/XUEXITONG_HEARTBEAT_INTEGRATION.md 的 bridge.ts 类型补丁。
// 合入位置：frontend/src/components/XuexitongHeartbeatPanel.tsx
import {useCallback,useEffect,useRef,useState} from "react";
import type {Course} from "../types";
import {friendlyBridgeError,request} from "../bridge";

export type HeartbeatTaskView={
  task_id:string;run_id:string;course_key:string;chapter:string;title:string;
  state:string;playing_time:number;duration:number;speed:number;
  last_send_state:string;sent_count:number;server_confirmed:boolean;
  server_play_time:number;end_reason:string;confirmed:boolean;resumable:boolean;
};

export type HeartbeatStatus={
  ok:boolean;running:boolean;run_id:string;course_key:string;
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
        request<{ok:boolean;events:HeartbeatLog[]}>({operation:"xuexitong.heartbeat.logs",limit:30}),
      ]);
      if(selectedCourse.current!==course.course_id)return;
      if(nextStatus.course_key===course.course_id){
        setStatus(nextStatus);
        setLogs(nextStatus.run_id?(nextLogs.events||[]):[]);
      }
    }catch(error){
      if(selectedCourse.current===course.course_id)setMessage(friendlyBridgeError(error));
    }finally{refreshInFlight.current=false;}
  },[course.course_id]);

  useEffect(()=>{
    setStatus(null);setLogs([]);
    void refresh();
    timer.current=window.setInterval(()=>{void refresh();},2000);
    return ()=>{if(timer.current!==null)window.clearInterval(timer.current);};
  },[refresh]);

  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    void request<{playback_speed:number;concurrency:number}>({operation:"xuexitong.settings.get"})
      .then(settings=>{
        if(active){setSpeed(settings.playback_speed);setJobs(settings.concurrency);}
      }).catch(()=>{});
    return ()=>{active=false;};
  },[desktop]);

  const control=async(action:"start"|"pause"|"resume"|"stop")=>{
    if(busy||!desktop)return;
    setBusy(true);setMessage("");
    try{
      if(action==="start"){
        await request<{ok:boolean;run_id:string}>({
          operation:"xuexitong.heartbeat.start",course_id:course.course_id,
          speed,jobs,instant_complete:instant,
          ...(mediaType!=="all"?{dtype:mediaType}:{}),
        });
        setMessage("本地心跳任务已启动。");
      }else{
        const runId=status?.run_id?{run_id:status.run_id}:{};
        if(action==="pause"){
          await request<{ok:boolean}>({operation:"xuexitong.heartbeat.pause",...runId});
        }else if(action==="resume"){
          await request<{ok:boolean}>({operation:"xuexitong.heartbeat.resume",...runId});
        }else{
          await request<{ok:boolean}>({operation:"xuexitong.heartbeat.stop",...runId});
        }
      }
      await refresh();
    }catch(error){setMessage(friendlyBridgeError(error));}
    finally{setBusy(false);}
  };

  const running=Boolean(status?.running);
  const tasks=status?.tasks||[];
  const canControl=Boolean(status?.queue_controls?.pause);

  return <section className="sf-platform-settings-view" aria-label="学习通本地心跳任务">
    <h3>本地心跳任务</h3>
    <p className="sf-hint">
      心跳包由本机生成并发送，不依赖网页播放器。
      「本地已申报」只表示请求发出，「服务端确认」表示平台返回任务通过标记，两者分开统计。
      视频与音频任务按 dtype 分别构造心跳包，可单独筛选运行。
    </p>

    <div className="sf-settings-row">
      <label>速度
        <input type="number" min={0.25} max={2} step={0.25} value={speed}
          disabled={running||!desktop}
          onChange={event=>setSpeed(Number(event.target.value))}/>
      </label>
      <label>并发章节
        <input type="number" min={1} max={4} step={1} value={jobs}
          disabled={running||!desktop}
          onChange={event=>setJobs(Number(event.target.value))}/>
      </label>
      <label>任务类型
        <select value={mediaType} disabled={running||!desktop}
          onChange={event=>setMediaType(event.target.value as "all"|"Video"|"Audio")}>
          <option value="all">视频 + 音频</option>
          <option value="Video">仅视频</option>
          <option value="Audio">仅音频</option>
        </select>
      </label>
      <label className="sf-check">
        <input type="checkbox" checked={instant} disabled={running||!desktop}
          onChange={event=>setInstant(event.target.checked)}/>
        首包申报整段完成
      </label>
    </div>

    <div className="sf-actions">
      <button type="button" disabled={busy||!desktop||running} onClick={()=>void control("start")}>开始</button>
      <button type="button" disabled={busy||!desktop||!canControl||!running} onClick={()=>void control("pause")}>暂停</button>
      <button type="button" disabled={busy||!desktop||!canControl||!running} onClick={()=>void control("resume")}>继续</button>
      <button type="button" disabled={busy||!desktop||!canControl} onClick={()=>void control("stop")}>停止</button>
      <button type="button" disabled={busy} onClick={()=>void refresh()}>刷新</button>
    </div>

    {message?<p className="sf-message">{message}</p>:null}

    <dl className="sf-stat-grid">
      <div><dt>运行状态</dt><dd>{running?"运行中":"空闲"}</dd></div>
      <div><dt>本地已申报</dt><dd>{status?.heartbeats.sent??0}</dd></div>
      <div><dt>服务端确认</dt><dd>{status?.heartbeats.server_confirmed??0}</dd></div>
      <div><dt>任务数</dt><dd>{status?.task_count??0}</dd></div>
      <div><dt>运行 ID</dt><dd>{status?.run_id||"—"}</dd></div>
      <div><dt>当前配置</dt><dd>{status?`${status.config.speed}x / ${status.config.jobs} 并发`:"—"}</dd></div>
    </dl>

    <table className="sf-task-table" aria-label="心跳任务状态">
      <thead><tr><th>任务</th><th>状态</th><th>本地进度</th><th>服务端进度</th><th>最近一次请求</th></tr></thead>
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
