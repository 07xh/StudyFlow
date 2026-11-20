import {RunParameters} from "./RunParameters";
import {ZhsQueuePanel} from "./ZhsQueuePanel";
import {rememberTaskRecovery,discardTaskRecovery} from "../taskRecovery";
import type {YuketangScope,YuketangSessionMarker} from "../bridge";
import {ZhsTaskSettingsPanel} from "./ZhsTaskSettingsPanel";
import {useCallback, useEffect, useId, useRef, useState} from "react";
import {Play, Square, RefreshCw, Activity} from "lucide-react";
import type {ActivityEntry,TaskRecorder} from "../activity";
import type {Course} from "../types";
import {request,friendlyBridgeError,type ZhidaoProgressSnapshot} from "../bridge";
import {
  getLegacyStatus, getYuketangLiveProgress, legacyError, legacyExitMessage, zhsDiagnosticMessage, originalYktDefaults, readYuketangCourseThreshold, startLegacy, stopLegacy,
  validateOriginalOptions, type LegacyTaskStatus, type OriginalYktOptions, type OriginalZhsOptions, type YuketangLiveProgress
} from "../legacyPlayback";

type YktVideoTask = YuketangLiveProgress["video_tasks"][number];

function YktVideoEvidence({video}:{video?:YktVideoTask}) {
  const local = video?.simulation_percent;
  const remote = video?.server_percent;
  const localLabel=local!=null ? local.toFixed(1)+"%" : "—";
  const remoteLabel=remote!=null ? remote.toFixed(1)+"%" : "—";
  return <div className="sf-ykt-video-evidence">
    <div><small>本地事件</small><strong>{localLabel}</strong>
      {local!=null&&<div className="sf-ykt-live-track" role="progressbar" aria-label="此视频本地事件位置"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={local}><span style={{width:local+"%"}}/></div>}
      <small>{video?.simulation_position!=null&&video.simulation_duration!=null
        ?video.simulation_position.toFixed(1)+" / "+video.simulation_duration.toFixed(1)+" 秒"
        :video?.simulation_duration!=null?"视频时长 "+video.simulation_duration.toFixed(1)+" 秒":"尚无可归属的位置"}</small>
    </div>
    <div><small>服务器返回</small><strong>{remoteLabel}</strong>
      {remote!=null&&<div className="sf-ykt-live-track" role="progressbar" aria-label="此视频日志记录的服务器进度"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={remote}><span style={{width:remote+"%"}}/></div>}
      <small>{remote==null?"尚未获得可归属的响应":
        (video?.server_source==="final"?"最终查询":video?.server_source==="periodic"?"定期查询":"开始前查询")+
        (video?.server_position!=null?" · "+video.server_position.toFixed(1)+" 秒":"")}</small>
    </div>
  </div>;
}

const labels: Record<LegacyTaskStatus["state"], string> = {
  idle: "未启动", running: "原版进程运行中",
  exited: "原版进程已退出", stopped: "已终止"
};

export function LegacyPlaybackPanel({
  platform, courses, desktop, connected, dark=true, onEvent, onCourseVerified, yuketangOptions, settingsReady=true, courseId, detailMode=false, events=[], onOpenTasks, courseSettingsOpen, onCourseSettingsClose
}: {
  platform: "zhidao" | "yuketang"; courses: Course[]; desktop: boolean; connected: boolean; dark?:boolean;
  onEvent?:TaskRecorder;
  onCourseVerified?:(course:Course)=>void;
  yuketangOptions?: OriginalYktOptions;
  settingsReady?: boolean;
  courseId?:string;
  detailMode?:boolean;
  events?:ActivityEntry[];
  onOpenTasks?:()=>void;
  courseSettingsOpen?:boolean;
  onCourseSettingsClose?:()=>void;
}) {
  const [status, setStatus] = useState<LegacyTaskStatus | null>(null);
  // Retain run ID after a failed status poll; never show cached telemetry as live.
  const [statusReadFailed, setStatusReadFailed] = useState(false);
  const [verificationState, setVerificationState] = useState<"idle"|"checking"|"verified"|"unknown">("idle");
  const verifiedRunRef = useRef<string | null>(null);
  const [verificationRetry, setVerificationRetry] = useState(0);
  const onCourseVerifiedRef = useRef(onCourseVerified);
  const onEventRef = useRef(onEvent);
  useEffect(()=>{onCourseVerifiedRef.current=onCourseVerified;},[onCourseVerified]);
  useEffect(()=>{onEventRef.current=onEvent;},[onEvent]);
  const latestStatusRequest = useRef(0);
  const statusPollInFlight = useRef<string | null>(null);
  const taskActionInFlight = useRef(false);
  const currentPlatform = useRef(platform);
  currentPlatform.current = platform;
  const [yktProgress, setYktProgress] = useState<YuketangLiveProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [zhsOptions,setZhsOptions] = useState<OriginalZhsOptions|null>(null);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState(courseId??"");
  const currentSelection=useRef(selection);
  currentSelection.current=selection;
  const options = yuketangOptions ?? {...originalYktDefaults};
  const playableCourses = courses.filter(c => c.platform === "zhidao" && (c.course_type === "ai" || c.course_type === "shared") && !c.stale);
  const ownsStatus=platform!=="zhidao"||Boolean(status?.course_id&&status.course_id===selection);
  const liveZhs = !statusReadFailed && platform === "zhidao" && status?.course_id === selection
    ? status.zhs_progress : null;
  // An expired local observation can supply only a clearly labelled last-known
  // resource identity; the numeric progress always comes from fresh telemetry.
  const zhsContext=status?.state==="running"&&ownsStatus&&status.zhs_stale
    ? status.zhs_last_resource : null;
  const zhsContent=liveZhs??zhsContext;
  const zhsKind=zhsContent?.resource_kind;
  const zhsKindLabel=zhsKind==="video"?"视频":zhsKind==="ppt"?"PPT":
    zhsKind==="article"?"文章":zhsKind==="other"?"其他资源":"类型待识别";
  // Previous local snapshots have no resourceKind. The upstream 'playing'
  // frame is still video-only; retain its bounded percent during upgrades.
  const zhsSegment=!liveZhs?.resource_kind||liveZhs.resource_kind==="video"
    ?liveZhs?.video_segment_percent:null;
  const selectedCourse=courses.find(course=>course.platform==="zhidao"&&course.course_id===selection)??null;
  const startHintId=useId();
  // Keep the existing launch gates; expose the first blocking condition instead of an unexplained disabled button.
  const startUnavailableReason=!desktop?"仅 Windows 桌面版支持运行任务。":
    !connected?"当前学习平台尚未确认连接；请先在平台页面检查登录状态。":
    busy?"任务操作正在进行，请等待当前操作结束。":
    statusReadFailed?"当前无法确认任务状态；请先查询运行状态。":
    status?.state==="running"?(ownsStatus?"当前任务已在运行，可以查询状态或停止任务。":"已有另一门课程的原版任务在运行，请在学习任务中管理。"):
    platform==="zhidao"?
      !selection?"尚未选择知到课程；请先从已同步课程列表进入课程详情。":
      !selectedCourse?"当前课程未在已同步课程列表中；请重新同步课程。":
      selectedCourse.stale?"当前课程数据已过期；请重新同步课程。":
      !playableCourses.some(course=>course.course_id===selection)?"当前课程缺少原版执行器支持的课程类型；请同步课程后确认课程类型，或使用官方播放器。":
      !zhsOptions?"当前课程 ZHS 参数尚未就绪；请通过下方「ZHS 原版 · 观看控制」重试读取。若保存的参数损坏，可在设置中确认恢复默认值（不清除登录）。":null:
      !settingsReady?"雨课堂默认参数尚未读取；请进入平台参数设置检查。":
      !validateOriginalOptions(options)?"雨课堂参数不在支持范围内；请进入平台参数设置修正。":null;
  const workerCount=platform==="yuketang"
    ?(yktProgress?.concurrent===false?1:
      yktProgress?.worker_slots?.length||(options.use_concurrent?options.max_concurrent_videos:1))
    :0;
  const videoTasks=yktProgress?.video_tasks??[];
  const videoByIndex=new Map<number,YktVideoTask>(videoTasks.map(video=>[video.video_index,video]));
  const workerSlots=Array.from({length:Math.max(0,Math.min(32,workerCount))},(_,index)=>{
    const observed=yktProgress?.worker_slots?.[index];
    const slot=observed??{slot:index+1,video_index:null,
      state:yktProgress?.available?"unknown" as const:"waiting" as const};
    const unfinished=["waiting","preparing","watching"].includes(slot.state);
    if(unfinished&&status?.state==="exited")return {...slot,state:"unknown" as const};
    if(unfinished&&status?.state==="stopped")return {...slot,state:"stopped" as const};
    return slot;
  });
  const workerStateLabels:Record<string,string>={
    waiting:"等待分配",preparing:"准备中",watching:"执行中",
    completed:"本轮处理结束 · 待平台核验",
    skipped:"本轮跳过 · 待平台核验",
    failed:"失败",stopped:"已停止",unknown:"状态待核实"
  };

  const updateStatus = useCallback(async () => {
    if (!desktop || taskActionInFlight.current) return;
    if (statusPollInFlight.current === platform) return;
    statusPollInFlight.current = platform;
    const requestId = ++latestStatusRequest.current;
    let timeoutId:number|undefined;
    try {
      // A suspended sidecar/IPC call must not hold the single-flight lock
      // forever and freeze every task card after laptop sleep.
      const next = await Promise.race<LegacyTaskStatus>([
        getLegacyStatus(platform),
        new Promise<never>((_,reject)=>{
          timeoutId=window.setTimeout(()=>reject(new Error("TASK_STATUS_TIMEOUT")),15000);
        })
      ]);
      if (requestId !== latestStatusRequest.current || taskActionInFlight.current || currentPlatform.current !== platform) return;
      if (platform==="zhidao" && next.state==="running" && next.course_id) {
        setSelection(previous => previous || next.course_id || "");
      }
      setStatus(next);
      setStatusReadFailed(false);
      setMessage(previous => previous.startsWith("无法读取本地任务状态；") ? "" : previous);
      if (platform === "yuketang" && next.run_id) {
        try {
          const progress = await getYuketangLiveProgress(next.run_id);
          if (requestId === latestStatusRequest.current && !taskActionInFlight.current && currentPlatform.current === platform) setYktProgress(progress);
        } catch {
          if (requestId === latestStatusRequest.current && !taskActionInFlight.current && currentPlatform.current === platform) setYktProgress(null);
        }
      } else setYktProgress(null);
    } catch {
      if (requestId !== latestStatusRequest.current || taskActionInFlight.current || currentPlatform.current !== platform) return;
      // The prior run ID can still be stopped after verifying it again.
      setStatusReadFailed(true);setYktProgress(null);
      setMessage("无法读取本地任务状态；显示的是上次记录，请重新查询。可尝试停止当前任务，停止前会核对运行标识。");
    } finally {
      if(timeoutId!==undefined)window.clearTimeout(timeoutId);
      if (statusPollInFlight.current === platform) statusPollInFlight.current = null;
    }
  }, [desktop, platform]);

  useEffect(() => {
    if(courseId)setSelection(courseId);
  },[courseId]);

  useEffect(() => {
    setStatus(null);
    setStatusReadFailed(false);
    setYktProgress(null);
    setMessage("");
    setVerificationRetry(0);
  }, [platform]);

  useEffect(() => {
    void updateStatus();
    if (!desktop) return;
    const timer = window.setInterval(() => { void updateStatus(); }, 2000);
    return () => { window.clearInterval(timer); latestStatusRequest.current++; };
  }, [desktop, updateStatus]);

  // One read-only server reconciliation per observed ZHS termination.
  // The execution's exit code and CLI percentages never count as proof.
  useEffect(() => {
    if (!desktop || platform !== "zhidao" || !ownsStatus) {
      verifiedRunRef.current = null;
      setVerificationState("idle");
      return;
    }
    if (status?.state === "running") {
      verifiedRunRef.current = null;
      setVerificationState("idle");
      return;
    }
    if (!connected || !status?.course_id || !status.run_id ||
        (status.state !== "exited" && status.state !== "stopped")) return;
    const marker = status.run_id + ":" + status.course_id + ":" + status.state + ":" + verificationRetry;
    if (verifiedRunRef.current === marker) return;
    verifiedRunRef.current = marker;
    let active = true;
    setVerificationState("checking");
    void request<ZhidaoProgressSnapshot>({
      operation:"zhidao.progress.verify",course_key:status.course_id
    }).then(snapshot => {
      if (!active || currentPlatform.current !== "zhidao") return;
      if (currentSelection.current !== status.course_id) return;
      const target = snapshot.courses.find(course =>
        course.platform === "zhidao" && course.course_id === status.course_id);
      if (target?.progress_evidence === "server_verified" && !target.stale && target.verified_at) {
        onCourseVerifiedRef.current?.(target);
        setVerificationState("verified");
        onEventRef.current?.("自动只读核验","success","已获取当前课程服务器记录；进度是否增加以核验值为准",{courseId:status.course_id,runId:status.run_id??undefined,runner:"zhs"});
      } else {
        setVerificationState("unknown");
        onEventRef.current?.("自动只读核验","warning","未获得当前课程可确认的服务器记录",{courseId:status.course_id,runId:status.run_id??undefined,runner:"zhs"});
      }
    }).catch(() => {
      if (!active || currentPlatform.current !== "zhidao") return;
      if (currentSelection.current !== status.course_id) return;
      setVerificationState("unknown");
      onEventRef.current?.("自动只读核验","warning","任务已结束，但服务器核验未成功；可手动重试",{courseId:status.course_id,runId:status.run_id??undefined,runner:"zhs"});
    });
    return () => {
      active = false;
      // A request cancelled by unmount/status change must be retryable.
      if (verifiedRunRef.current === marker) verifiedRunRef.current = null;
    };
  }, [desktop, platform, connected, ownsStatus, status?.state, status?.course_id, status?.run_id, verificationRetry]);



  async function start() {
    if (taskActionInFlight.current) return;
    taskActionInFlight.current = true;
    const requestId = ++latestStatusRequest.current;
    setBusy(true); setMessage("");setYktProgress(null);
    try {
      let lastScope:YuketangScope|null=null;
      let sessionMarker:string|null=null;
      let launchOptions=options;
      if(platform==="yuketang"){
        lastScope=await request<YuketangScope>({operation:"yuketang.scope.get"});
        if(!lastScope.has_session||!lastScope.classroom_id||!lastScope.university_id)
          throw new Error("YUKETANG_SCOPE_UNAVAILABLE");
        // Platform settings can change in a separate modal while this course
        // view remains mounted. Only the fresh, persisted values may launch a
        // new task; a stale props snapshot must never override the saved ones.
        const latest=await request<OriginalYktOptions>({operation:"yuketang.settings.get"});
        if(!validateOriginalOptions(latest))throw new Error("YUKETANG_SETTINGS_UNAVAILABLE");
        launchOptions={...latest,completion_threshold:
          readYuketangCourseThreshold(lastScope.classroom_id,lastScope.university_id)??100};
        try{
          const identity=await request<YuketangSessionMarker>({operation:"yuketang.session.marker"});
          sessionMarker=/^[a-f0-9]{64}$/.test(identity.marker)?identity.marker:null;
        }catch{/* Recovery metadata must not prevent the original task launching. */}
      }
      const next = await startLegacy(platform, platform === "zhidao" ? selection : undefined,
        platform === "yuketang" ? launchOptions : undefined, platform === "zhidao" ? zhsOptions ?? undefined : undefined);
      if(next.state==="running"&&next.run_id){
        const persisted=platform==="zhidao"&&zhsOptions
          ?rememberTaskRecovery({version:1,platform:"zhidao",runId:next.run_id,startedAt:Date.now(),
              courseId:selection,zhsOptions})
          :platform==="yuketang"&&lastScope&&sessionMarker
            ?rememberTaskRecovery({version:1,platform:"yuketang",runId:next.run_id,startedAt:Date.now(),
                courseId:null,classroomId:lastScope.classroom_id,universityId:lastScope.university_id,
                sessionMarker,yuketangOptions:launchOptions})
            :false;
        if(!persisted)setMessage("任务已启动，但本机恢复记录保存失败；请检查应用存储权限。");
      }
      if (requestId === latestStatusRequest.current && currentPlatform.current === platform) {
        setStatus(next);setStatusReadFailed(false);
      }
      if (currentPlatform.current === platform) setMessage(previous=>previous||"已发起原版任务，正在监测进程状态；若启动失败会显示退出原因。");
      onEvent?.("启动原版任务","success","原版进程已启动；服务端学习进度仍需单独核验",{courseId:platform==="zhidao"?selection:undefined,runId:next.run_id??undefined,runner:platform==="zhidao"?"zhs":"yuketang",parameters:platform==="yuketang"?{...launchOptions}:zhsOptions?{...zhsOptions,selected_ids:zhsOptions.selected_ids?.length??0,completion_threshold:zhsOptions.completion_threshold??"自动（原版）"}:undefined});
    } catch (error) {
      const msg=error instanceof Error&&(error.message.includes("YUKETANG")||error.message==="INVALID_IPC_RESPONSE")?friendlyBridgeError(error):legacyError(error);
      if (currentPlatform.current === platform) setMessage(msg);
      onEvent?.("启动原版任务","warning",msg,{courseId:platform==="zhidao"?selection:undefined,runner:platform==="zhidao"?"zhs":"yuketang"});
    }
    finally {
      taskActionInFlight.current = false;
      setBusy(false);
      if (currentPlatform.current === platform) void updateStatus();
    }
  }

  async function stop() {
    if (taskActionInFlight.current || !ownsStatus || !status?.run_id || status.state!=="running") return;
    taskActionInFlight.current = true;
    const requestId = ++latestStatusRequest.current;
    setBusy(true);setMessage("");
    try {
      const latest=await getLegacyStatus(platform);
      if(latest.state!=="running"||latest.run_id!==status.run_id||latest.course_id!==status.course_id){
        if (requestId === latestStatusRequest.current && currentPlatform.current === platform) {
          setStatus(latest);setStatusReadFailed(false);setMessage("运行任务已变化，请查看学习任务。");
        }
        return;
      }
      const next = await stopLegacy(platform,status.run_id);
      discardTaskRecovery(platform,status.run_id);
      if (requestId === latestStatusRequest.current && currentPlatform.current === platform) {
        setStatus(next);setStatusReadFailed(false);
      }
      if (currentPlatform.current === platform) setMessage("已终止由学序启动的原版任务；请重新查询服务器学习记录。");
      onEvent?.("停止原版任务","success","已停止学序托管的原版进程",{courseId:status.course_id??undefined,runId:status.run_id,runner:platform==="zhidao"?"zhs":"yuketang"});
    } catch(error) {
      if (currentPlatform.current === platform) setMessage(legacyError(error));
      onEvent?.("停止原版任务","warning",legacyError(error),{courseId:status.course_id??undefined,runId:status.run_id,runner:platform==="zhidao"?"zhs":"yuketang"});
    }
    finally {
      taskActionInFlight.current = false;
      setBusy(false);
      if (currentPlatform.current === platform) void updateStatus();
    }
  }

  return <section className="legacy-playback-panel">
    <div className="section-head">
      <div><h3><Activity size={17}/> {platform === "zhidao" ? "知到原版任务" : "运行任务"}</h3>
      </div>
      <span className={status?.state === "running" ? "legacy-run-state active" : "legacy-run-state"}>
        {statusReadFailed ? "状态待核实" : status ? (!ownsStatus&&status.state==="running"?"其他课程任务运行中":labels[status.state]) : desktop ? "状态未确认" : "仅 Windows 可运行"}
      </span>
    </div>
    {!ownsStatus&&status?.state==="running"&&<p className="sf-task-context">另一门课程的 ZHS 任务正在运行。{onOpenTasks&&<button className="text-button" onClick={onOpenTasks}>查看运行任务</button>}</p>}
    <div className="actions legacy-actions">
      <button className="primary" type="button" disabled={startUnavailableReason!==null}
        aria-describedby={startUnavailableReason?startHintId:undefined}
        title={startUnavailableReason??undefined}
        onClick={()=>void start()}><Play size={16}/> {platform==="yuketang"?"启动平台批量任务":"启动原版任务"}</button>
      <button className="secondary" type="button" disabled={!desktop||busy||!ownsStatus||!status?.run_id||status?.state!=="running"}
        onClick={()=>void stop()}><Square size={16}/> 停止</button>
      <button className="secondary" type="button" disabled={!desktop||busy}
        onClick={()=>void updateStatus()}><RefreshCw size={16}/> 查询运行状态</button>
    </div>
    {startUnavailableReason&&<p id={startHintId} className="sf-task-context sf-start-unavailable-reason" role="status">
      暂不能启动：{startUnavailableReason}
    </p>}
    {platform==="zhidao"&&ownsStatus&&status?.zhs_queue&&<ZhsQueuePanel status={status} unavailable={statusReadFailed} onRefresh={updateStatus}/>}
    {platform==="zhidao"&&(!ownsStatus||!status?.zhs_queue)&&<div className={"sf-live-progress-summary sf-has-zhs"+(detailMode?" sf-detail-simulation-only":"")} aria-label="当前内容与播放位置">
      <div className="sf-live-state sf-zhs-now-playing">
        <div className="sf-zhs-now-heading">
          <span>正在观看 / 处理</span>
          <span className={"sf-zhs-now-state"+(status?.state==="running"&&!statusReadFailed&&ownsStatus?" active":"")}>
            {statusReadFailed?"状态待核实":!ownsStatus&&status?.state==="running"?"其他课程运行中":
              status?.state==="running"?(status.zhs_stale?"采样待同步":"运行中"):
              status?.state==="exited"?"本次已结束":status?.state==="stopped"?"已停止":"未启动"}
          </span>
        </div>
        <strong className="sf-zhs-now-title" title={zhsContent?.resource_name??undefined}>
          {zhsContent?.resource_name??(status?.state==="running"&&ownsStatus
            ?"等待识别当前内容":status?.state==="exited"?"本次任务已结束":"当前没有正在播放的内容")}
        </strong>
        <div className="sf-zhs-now-meta">
          <span>{status?.zhs_stale&&zhsContext?"上次识别 · ":""}{zhsKindLabel}</span>
          {zhsContent?.resource_index!=null&&zhsContent.resource_total!=null&&
            <span>资源 {zhsContent.resource_index} / {zhsContent.resource_total}</span>}
        </div>
        <div className="sf-zhs-now-progress-row">
          <span>{zhsKind==="ppt"||zhsKind==="article"?"当前内容处理状态":"本次视频播放位置"}</span>
          <strong>{zhsSegment!=null?zhsSegment.toFixed(1)+"%":
            status?.state==="running"&&ownsStatus?"待同步":"—"}</strong>
        </div>
        <div className={"sf-verified-track sf-zhs-progress-track"+(zhsSegment==null&&status?.state==="running"&&ownsStatus&&!statusReadFailed?" is-indeterminate":"")}
          role="progressbar" aria-label={zhsKind==="article"||zhsKind==="ppt"?"当前内容处理进度":"当前视频片段位置"} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={zhsSegment??undefined}
          aria-valuetext={zhsSegment!=null?zhsSegment.toFixed(1)+"%":
            "当前尚无可确认的播放百分比"}>
          <span style={{width:zhsSegment!=null?zhsSegment+"%":"0%"}}/>
        </div>
        <small className="sf-zhs-now-footnote">
          {zhsSegment!=null?"本地片段位置 · 非课程总进度":
            status?.state==="running"&&ownsStatus
              ?status.zhs_stale?"运行中 · 最近采样已过期":"正在等待播放进度":
              "本次暂无可展示的播放位置"}
        </small>
        <details className="sf-zhs-diagnostics">
          <summary>采样与核验详情</summary>
          <div>
            <small>任务状态：{statusReadFailed?"状态待核实":status?labels[status.state]:"待确认"} · 约每 2 秒查询</small>

            {status?.zhs_stale&&ownsStatus&&<small role="status">本地进度输出已过期；仅保留上次识别的资源信息，未沿用旧进度值。</small>}
            {status?.state==="exited"&&ownsStatus&&liveZhs&&<small>任务已结束 · 显示结束前最后一次真实采样</small>}
            <small>当前片段位置属于本地采样，非服务器确认进度，也不代表平台完成状态。</small>
          </div>
        </details>
        {status?.state==="exited"&&ownsStatus&&!statusReadFailed&&<div className="sf-task-context sf-zhs-exit-diagnostic" role="status" aria-live="polite">
          <strong>{legacyExitMessage(status)}（退出码：{status.exit_code??"未知"}）</strong>
          {status.exit_code!==0&&<small>{zhsDiagnosticMessage(status)}</small>}
          {status.exit_code===0&&!status.zhs_progress&&<small>本次未采集到播放进度，是否完成请以服务器只读核验为准。</small>}
        </div>}
      </div>
    </div>}
    {platform === "yuketang" && <div className={"sf-ykt-live"+(detailMode?" sf-detail-live":"")} aria-label="雨课堂原版实时进度">
      <div className="sf-ykt-live-title"><strong>并发任务进度</strong>
        <small>{yktProgress?.available ? "执行记录已读取" : "暂无进度记录"}</small></div>
      <div className="sf-ykt-worker-grid" aria-label="并发任务独立状态">
        {status?.run_id&&status.state!=="idle"?workerSlots.map(slot=>{
          const video=slot.video_index!=null?videoByIndex.get(slot.video_index):undefined;
          return <article className="sf-ykt-worker" key={slot.slot}>
            <div className="sf-ykt-worker-heading">
              <strong>{yktProgress?.concurrent===false?"视频任务":"并发槽位 "+slot.slot}</strong>
              <span>{workerStateLabels[slot.state]??"状态待核实"}</span>
            </div>
            <small>{slot.video_index==null?(slot.state==="waiting"?"尚未分配视频":"视频归属待核实"):"视频任务 #"+slot.video_index}</small>
            {video?.name&&<strong className="sf-ykt-video-name" title={video.name}>{video.name}</strong>}
            <YktVideoEvidence video={video}/>
          </article>;
        }):<p className="sf-muted">启动批量任务后显示实际并发状态。</p>}
      </div>
      {videoTasks.length>0&&<details className="sf-ykt-video-details">
        <summary>逐视频详情 · {videoTasks.length} 项</summary>
        <div className="sf-ykt-video-list">
          {videoTasks.map(video=>{
            const state=status?.state==="stopped"&&["watching","preparing"].includes(video.state)
              ?"stopped":status?.state==="exited"&&["watching","preparing"].includes(video.state)
              ?"unknown":video.state;
            return <article className="sf-ykt-video-row" key={video.video_index}>
              <div className="sf-ykt-worker-heading">
                <strong>#{video.video_index} · {video.name||"视频名称尚未采集"}</strong>
                <span>{workerStateLabels[state]??"状态待核实"}</span>
              </div>
              <YktVideoEvidence video={video}/>
            </article>;
          })}
        </div>
        <small className="sf-ykt-live-note">最多显示本次日志中最近识别的 256 条视频任务；旧日志若没有 Worker 归属标记，不推测其百分比。</small>
      </details>}
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
      <small className="sf-ykt-live-note">本轮视频执行结束或跳过不代表平台已完成。并发模式下按原版 Worker 实际调用归属记录本地事件及服务器响应；未能归属的进度仍留空。单节是否完成以课程章节中的服务器只读核验为准，诊断区最近值也不代表课程总进度。</small>
      </details>
    </div>}
    {platform === "zhidao"&&<ZhsTaskSettingsPanel desktop={desktop} dark={dark} courseId={selection} courseType={selectedCourse?.course_type}
      settingsOpen={courseSettingsOpen} onSettingsClose={onCourseSettingsClose} hideTrigger={detailMode}
      onReady={setZhsOptions} onEvent={onEvent}/>}
    {platform === "zhidao"&&!detailMode&&<div className="legacy-field">
      <label htmlFor="legacy-zhidao-course">原版 ZHS 0.1.5 · 选择知到课程</label>
      <select id="legacy-zhidao-course" value={selection} onChange={e=>setSelection(e.target.value)}>
        <option value="">选择已同步的知到课程</option>
        {playableCourses.map(c=><option value={c.course_id} key={c.course_id}>{c.title}</option>)}
      </select>
    </div>}
    {platform === "zhidao"&&detailMode&&ownsStatus&&<div className="legacy-field sf-legacy-course-context">
      <span>任务所属课程</span><strong>{selectedCourse?.title??"课程未同步"}</strong>
    </div>}

    {platform==="yuketang"&&status?.state==="exited"&&ownsStatus&&!statusReadFailed&&<p className="legacy-state-note">
      {legacyExitMessage(status)}（退出码：{status.exit_code ?? "未知"}）
    </p>}
    {status?.run_id&&ownsStatus&&<RunParameters parameters={events.find(event=>event.runner===(platform==="zhidao"?"zhs":"yuketang")&&event.runId===status.run_id&&event.parameters)?.parameters}/>}
    {platform==="zhidao"&&ownsStatus&&verificationState!=="idle"&&
      <p className="legacy-state-note" role="status">
        {verificationState==="checking"?"正在只读核验当前课程的服务器记录…":
          verificationState==="verified"?"已读取当前课程的服务器学习记录；请以核验值判断是否完成。":
          "未确认当前课程的最新服务器记录；请在进度核验区手动重试。"}
      </p>}
    {platform==="zhidao"&&ownsStatus&&connected&&verificationState==="unknown"&&
      <button className="secondary" type="button" onClick={()=>setVerificationRetry(previous=>previous+1)}>
        <RefreshCw size={14}/> 重试服务器核验
      </button>}
    {message&&<p className="legacy-state-note" role="status">{message}</p>}
    {status?.run_id&&<p className="legacy-disclaimer">平台进度以服务端核验结果为准。</p>}
  </section>;
}
