import {useCallback, useEffect, useState} from "react";
import {Play, Square, RefreshCw, Activity} from "lucide-react";
import type {Course, Platform} from "../types";
import {request,friendlyBridgeError} from "../bridge";
import {
  getLegacyStatus, getYuketangLiveProgress, legacyError, originalYktDefaults, startLegacy, stopLegacy,
  validateOriginalOptions, type LegacyTaskStatus, type OriginalYktOptions, type YuketangLiveProgress
} from "../legacyPlayback";

const labels: Record<LegacyTaskStatus["state"], string> = {
  idle: "未启动", running: "原版进程运行中",
  exited: "原版进程已退出", stopped: "已终止"
};

export function LegacyPlaybackPanel({
  platform, courses, desktop, connected, onEvent, yuketangOptions, settingsReady=true, courseId, detailMode=false
}: {
  platform: Platform; courses: Course[]; desktop: boolean; connected: boolean;
  onEvent?: (action:string,result:"success"|"warning",detail:string)=>void;
  yuketangOptions?: OriginalYktOptions;
  settingsReady?: boolean;
  courseId?:string;
  detailMode?:boolean;
}) {
  const [status, setStatus] = useState<LegacyTaskStatus | null>(null);
  const [yktProgress, setYktProgress] = useState<YuketangLiveProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState(courseId??"");
  const options = yuketangOptions ?? {...originalYktDefaults};
  const aiCourses = courses.filter(c => c.platform === "zhidao" && c.course_type === "ai");
  const liveZhs = platform === "zhidao" && status?.state === "running" &&
    status.course_id === selection ? status.zhs_progress : null;
  const selectedCourse=courses.find(course=>course.course_id===selection)??null;
  const workerCount=platform==="yuketang"
    ?(yktProgress?.worker_slots?.length||((options.use_concurrent?options.max_concurrent_videos:1)))
    :0;
  const workerSlots=Array.from({length:Math.max(0,Math.min(32,workerCount))},(_,index)=>
    yktProgress?.worker_slots?.[index]??{slot:index+1,video_index:null,state:"waiting" as const});
  const workerStateLabels:Record<string,string>={
    waiting:"等待分配",preparing:"准备中",watching:"执行中",completed:"已完成",
    skipped:"已跳过",failed:"失败",stopped:"已停止",unknown:"状态待核实"
  };

  const updateStatus = useCallback(async () => {
    if (!desktop) return;
    try {
      const next = await getLegacyStatus(platform);
      if (platform==="zhidao" && next.state==="running" && next.course_id) {
        setSelection(previous => previous || next.course_id || "");
      }
      setStatus(next);
      if (platform === "yuketang" && next.run_id) {
        try { setYktProgress(await getYuketangLiveProgress(next.run_id)); }
        catch { setYktProgress(null); }
      } else setYktProgress(null);
    } catch { setStatus(null);setYktProgress(null); }
  }, [desktop, platform]);

  useEffect(() => {
    if(courseId)setSelection(courseId);
  },[courseId]);

  useEffect(() => {
    void updateStatus();
    if (!desktop) return;
    const timer = window.setInterval(() => { void updateStatus(); }, 2000);
    return () => window.clearInterval(timer);
  }, [desktop, updateStatus]);



  async function start() {
    setBusy(true); setMessage("");setYktProgress(null);
    try {
      if(platform==="yuketang") await request<OriginalYktOptions>({operation:"yuketang.settings.save",settings:options});
      const next = await startLegacy(platform, platform === "zhidao" ? selection : undefined,
        platform === "yuketang" ? options : undefined);
      setStatus(next);
      setMessage("已启动原版任务进程。进程运行不代表服务器已经接受心跳或确认学习进度。");
      onEvent?.("启动原版任务","success","原版进程已启动；服务端学习进度仍需单独核验");
    } catch (error) {
      const msg=error instanceof Error&&(error.message.includes("YUKETANG")||error.message==="INVALID_IPC_RESPONSE")?friendlyBridgeError(error):legacyError(error);
      setMessage(msg);onEvent?.("启动原版任务","warning",msg);
    }
    finally {setBusy(false);}
  }

  async function stop() {
    setBusy(true);setMessage("");
    try {
      setStatus(await stopLegacy(platform));
      setMessage("已终止由学序启动的原版任务；请重新查询服务器学习记录。");
      onEvent?.("停止原版任务","success","已停止学序托管的原版进程");
    } catch(error) {setMessage(legacyError(error));onEvent?.("停止原版任务","warning",legacyError(error));}
    finally {setBusy(false);}
  }

  return <section className="legacy-playback-panel">
    <div className="section-head">
      <div><h3><Activity size={17}/> {platform === "zhidao" ? "知到原版任务" : "运行任务"}</h3>
      </div>
      <span className={status?.state === "running" ? "legacy-run-state active" : "legacy-run-state"}>
        {status ? labels[status.state] : desktop ? "状态未确认" : "仅 Windows 可运行"}
      </span>
    </div>
    {platform==="zhidao"&&<div className={"sf-live-progress-summary"+(platform==="zhidao"?" sf-has-zhs":"")+(detailMode?" sf-detail-simulation-only":"")} aria-label="运行状态、本地模拟片段和平台学习进度">
      <div className="sf-live-state">
        <span>任务运行状态</span>
        <strong>{status ? labels[status.state] : desktop ? "检测中" : "未连接桌面端"}</strong>
        <small>约每 2 秒更新</small>
        {platform==="zhidao"&&<div className="sf-zhs-local" aria-label="ZHS 原版本地模拟片段">
          <div className="sf-zhs-local-heading">
            <span>本地模拟片段</span>
            <strong>{liveZhs?.video_segment_percent != null
              ? liveZhs.video_segment_percent.toFixed(1)+"%"
              : "—"}</strong>
          </div>
          {liveZhs?.video_segment_percent != null
            ? <div className="sf-verified-track" role="progressbar" aria-label="当前本地模拟片段进度"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={liveZhs.video_segment_percent}>
                <span style={{width:liveZhs.video_segment_percent+"%"}}/>
              </div>
            : <small>{status?.state==="running"
                ? status.course_id===selection ? "等待原版输出" : "请选择正在运行的课程"
                : "任务未运行"}</small>}
          {liveZhs?.resource_index!=null&&liveZhs.resource_total!=null&&
            <small>当前知识点资源 {liveZhs.resource_index}/{liveZhs.resource_total}</small>}
          <small>仅原版本地输出，非服务器确认进度</small>
        </div>}
      </div>
    </div>}
    {platform === "yuketang" && <div className={"sf-ykt-live"+(detailMode?" sf-detail-live":"")} aria-label="雨课堂原版实时进度">
      <div className="sf-ykt-live-title"><strong>并发任务进度</strong>
        <small>{yktProgress?.available ? "本次任务日志 · 每 2 秒读取" : "本次任务尚无进度记录"}</small></div>
      <div className="sf-ykt-worker-grid" aria-label="并发任务独立状态">
        {workerSlots.map(slot=><article className="sf-ykt-worker" key={slot.slot}>
          <div className="sf-ykt-worker-heading">
            <strong>并发槽位 {slot.slot}</strong>
            <span>{status?.state==="running"
              ?workerStateLabels[slot.state]??"状态待核实"
              :status?.state==="stopped"?"任务已停止":
                workerStateLabels[slot.state]??"等待任务"}</span>
          </div>
          <small>{slot.video_index==null?"尚未分配视频":"视频任务 #"+slot.video_index}</small>
          <div className="sf-ykt-worker-track" aria-hidden="true"><span/></div>
          <small>单任务进度：—（原版日志未标注心跳归属）</small>
        </article>)}
      </div>
      <details className="sf-ykt-diagnostics">
        <summary>运行诊断 · 最近一次响应</summary>
        <div className="sf-ykt-live-grid">
        <div className="sf-ykt-live-item">
          <span>最近一条模拟位置</span>
          <strong>{yktProgress?.simulation_percent != null ? yktProgress.simulation_percent.toFixed(1)+"%" : "—"}</strong>
          {yktProgress?.simulation_percent != null && <div className="sf-ykt-live-track" role="progressbar"
            aria-label="原版最近一条模拟播放位置" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={yktProgress.simulation_percent}>
            <span style={{width:yktProgress.simulation_percent+"%"}}/></div>}
          <small>{yktProgress?.simulation_position != null && yktProgress.simulation_duration != null
            ? yktProgress.simulation_position.toFixed(1)+" / "+yktProgress.simulation_duration.toFixed(1)+" 秒"
            : "等待原版输出"}</small>
        </div>
        <div className="sf-ykt-live-item">
          <span>最近一次服务端进度响应</span>
          <strong>{yktProgress?.server_percent != null ? yktProgress.server_percent.toFixed(1)+"%" : "—"}</strong>
          {yktProgress?.server_percent != null && <div className="sf-ykt-live-track" role="progressbar"
            aria-label="原版日志记录的服务端返回进度" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={yktProgress.server_percent}>
            <span style={{width:yktProgress.server_percent+"%"}}/></div>}
          <small>{yktProgress?.server_source==="final"?"最终查询":
            yktProgress?.server_source==="periodic"?"定期查询":
            yktProgress?.server_source==="initial"?"开始前查询":"等待服务器返回"}
            {yktProgress?.server_position != null ? " · 最后位置 "+yktProgress.server_position.toFixed(1)+" 秒" : ""}</small>
        </div>
        <div className="sf-ykt-live-item">
          <span>批量任务</span>
          <strong>{yktProgress?.available ?
            yktProgress.processed+" / "+(yktProgress.total??"—") : "—"}</strong>
          <small>{yktProgress?.available ?
            "成功 "+yktProgress.success+" · 跳过 "+yktProgress.skipped+
            " · 失败 "+yktProgress.failed+" · 停止 "+yktProgress.stopped : "等待原版任务统计"}</small>
          {yktProgress?.current_index != null && <small>正在处理第 {yktProgress.current_index} 个视频</small>}
        </div>
        {yktProgress?.rich_total != null && <div className="sf-ykt-live-item">
          <span>图文任务</span>
          <strong>{yktProgress.rich_processed} / {yktProgress.rich_total}</strong>
          <small>成功 {yktProgress.rich_success} · 失败 {yktProgress.rich_failed}</small>
          {yktProgress.rich_current != null && <small>处理到第 {yktProgress.rich_current} 篇图文</small>}
        </div>}
      </div>
      </details>
      <small className="sf-ykt-live-note">各槽位状态来自原版 Worker 日志。心跳无法对应到单个视频，百分比保持空白；诊断区的最近值也不代表课程总进度。</small>
    </div>}
    {platform === "zhidao"&&!detailMode&&<div className="legacy-field">
      <label htmlFor="legacy-zhidao-course">原版 ZHS 0.1.5 · 选择智慧课程</label>
      <select id="legacy-zhidao-course" value={selection} onChange={e=>setSelection(e.target.value)}>
        <option value="">选择已同步的智慧课程</option>
        {aiCourses.map(c=><option value={c.course_id} key={c.course_id}>{c.title}</option>)}
      </select>
    </div>}
    {platform === "zhidao"&&detailMode&&<div className="legacy-field sf-legacy-course-context">
      <span>当前运行课程</span><strong>{selectedCourse?.title??"课程未同步"}</strong>
    </div>}
    <div className="actions legacy-actions">
      <button className="primary" type="button" disabled={!desktop||!connected||busy||
        status?.state==="running"||
        (platform==="zhidao" && !aiCourses.some(c=>c.course_id===selection))||
        (platform==="yuketang" && (!settingsReady || !validateOriginalOptions(options)))}
        onClick={()=>void start()}><Play size={16}/> 启动原版任务</button>
      <button className="secondary" type="button" disabled={!desktop||busy||status?.state!=="running"}
        onClick={()=>void stop()}><Square size={16}/> 停止</button>
      <button className="secondary" type="button" disabled={!desktop||busy}
        onClick={()=>void updateStatus()}><RefreshCw size={16}/> 查询运行状态</button>
    </div>
    {status?.state==="exited"&&<p className="legacy-state-note">
      原版进程退出码：{status.exit_code ?? "未知"}。退出码不等于服务器心跳或学习完成确认。
    </p>}
    {message&&<p className="legacy-state-note" role="status">{message}</p>}
    <p className="legacy-disclaimer">平台进度以服务端核验结果为准。</p>
  </section>;
}
