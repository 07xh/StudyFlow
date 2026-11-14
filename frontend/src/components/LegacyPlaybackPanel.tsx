import {useCallback, useEffect, useRef, useState} from "react";
import {Play, Square, RefreshCw, Activity} from "lucide-react";
import type {Course, Platform} from "../types";
import {request,friendlyBridgeError,type ZhidaoProgressSnapshot} from "../bridge";
import {presentCourse} from "../presentation";
import {
  getLegacyStatus, getYuketangLiveProgress, legacyError, legacyExitMessage, originalYktDefaults, startLegacy, stopLegacy,
  validateOriginalOptions, type LegacyTaskStatus, type OriginalYktOptions, type YuketangLiveProgress
} from "../legacyPlayback";

const labels: Record<LegacyTaskStatus["state"], string> = {
  idle: "未启动", running: "原版进程运行中",
  exited: "原版进程已退出", stopped: "已终止"
};

export function LegacyPlaybackPanel({
  platform, courses, desktop, connected, onEvent, onCourseVerified, yuketangOptions, settingsReady=true, courseId, detailMode=false
}: {
  platform: Platform; courses: Course[]; desktop: boolean; connected: boolean;
  onEvent?: (action:string,result:"success"|"warning",detail:string)=>void;
  onCourseVerified?: (course:Course)=>void;
  yuketangOptions?: OriginalYktOptions;
  settingsReady?: boolean;
  courseId?:string;
  detailMode?:boolean;
}) {
  const [status, setStatus] = useState<LegacyTaskStatus | null>(null);
  const [verificationState, setVerificationState] = useState<"idle"|"checking"|"verified"|"unknown">("idle");
  const verifiedRunRef = useRef<string | null>(null);
  const onCourseVerifiedRef = useRef(onCourseVerified);
  const onEventRef = useRef(onEvent);
  useEffect(()=>{onCourseVerifiedRef.current=onCourseVerified;},[onCourseVerified]);
  useEffect(()=>{onEventRef.current=onEvent;},[onEvent]);
  const latestStatusRequest = useRef(0);
  const taskActionInFlight = useRef(false);
  const currentPlatform = useRef(platform);
  currentPlatform.current = platform;
  const [yktProgress, setYktProgress] = useState<YuketangLiveProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState(courseId??"");
  const options = yuketangOptions ?? {...originalYktDefaults};
  const playableCourses = courses.filter(c => c.platform === "zhidao" && (c.course_type === "ai" || c.course_type === "shared") && !c.stale);
  const verified = courses.filter(course => course.platform === platform)
    .map(course => ({course, presentation: presentCourse(course)}))
    .filter(item => item.presentation.status === "verified" && item.presentation.percent !== null);
  const liveZhs = platform === "zhidao" && status?.course_id === selection
    ? status.zhs_progress : null;
  const selectedCourse=courses.find(course=>course.platform==="zhidao"&&course.course_id===selection)??null;

  const updateStatus = useCallback(async () => {
    if (!desktop || taskActionInFlight.current) return;
    const requestId = ++latestStatusRequest.current;
    try {
      const next = await getLegacyStatus(platform);
      if (requestId !== latestStatusRequest.current || taskActionInFlight.current || currentPlatform.current !== platform) return;
      if (platform==="zhidao" && next.state==="running" && next.course_id) {
        setSelection(previous => previous || next.course_id || "");
      }
      setStatus(next);
      if (next.state === "exited") {
        setMessage("");
      }
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
      setStatus(null);setYktProgress(null);
    }
  }, [desktop, platform]);

  useEffect(() => {
    if(courseId)setSelection(courseId);
  },[courseId]);

  useEffect(() => {
    setStatus(null);
    setYktProgress(null);
    setMessage("");
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
    if (!desktop || platform !== "zhidao") {
      verifiedRunRef.current = null;
      setVerificationState("idle");
      return;
    }
    if (status?.state === "running") {
      verifiedRunRef.current = null;
      setVerificationState("idle");
      return;
    }
    if (!connected || !status?.course_id ||
        (status.state !== "exited" && status.state !== "stopped")) return;
    const marker = status.course_id + ":" + status.state;
    if (verifiedRunRef.current === marker) return;
    verifiedRunRef.current = marker;
    let active = true;
    setVerificationState("checking");
    void request<ZhidaoProgressSnapshot>({
      operation:"zhidao.progress.verify",course_key:status.course_id
    }).then(snapshot => {
      if (!active || currentPlatform.current !== "zhidao") return;
      const target = snapshot.courses.find(course =>
        course.platform === "zhidao" && course.course_id === status.course_id);
      if (target?.progress_evidence === "server_verified" && !target.stale && target.verified_at) {
        onCourseVerifiedRef.current?.(target);
        setVerificationState("verified");
        onEventRef.current?.("自动只读核验","success","已获取当前课程服务器记录；进度是否增加以核验值为准");
      } else {
        setVerificationState("unknown");
        onEventRef.current?.("自动只读核验","warning","未获得当前课程可确认的服务器记录");
      }
    }).catch(() => {
      if (!active || currentPlatform.current !== "zhidao") return;
      setVerificationState("unknown");
      onEventRef.current?.("自动只读核验","warning","任务已结束，但服务器核验未成功；可手动重试");
    });
    return () => {
      active = false;
      // A request cancelled by unmount/status change must be retryable.
      if (verifiedRunRef.current === marker) verifiedRunRef.current = null;
    };
  }, [desktop, platform, connected, status?.state, status?.course_id]);



  async function start() {
    if (taskActionInFlight.current) return;
    taskActionInFlight.current = true;
    const requestId = ++latestStatusRequest.current;
    setBusy(true); setMessage("");setYktProgress(null);
    try {
      if(platform==="yuketang") await request<OriginalYktOptions>({operation:"yuketang.settings.save",settings:options});
      const next = await startLegacy(platform, platform === "zhidao" ? selection : undefined,
        platform === "yuketang" ? options : undefined);
      if (requestId === latestStatusRequest.current && currentPlatform.current === platform) setStatus(next);
      if (currentPlatform.current === platform) setMessage("已发起原版任务，正在监测进程状态；若启动失败会显示退出原因。");
      onEvent?.("启动原版任务","success","原版进程已启动；服务端学习进度仍需单独核验");
    } catch (error) {
      const msg=error instanceof Error&&(error.message.includes("YUKETANG")||error.message==="INVALID_IPC_RESPONSE")?friendlyBridgeError(error):legacyError(error);
      if (currentPlatform.current === platform) setMessage(msg);
      onEvent?.("启动原版任务","warning",msg);
    }
    finally {
      taskActionInFlight.current = false;
      setBusy(false);
      if (currentPlatform.current === platform) void updateStatus();
    }
  }

  async function stop() {
    if (taskActionInFlight.current) return;
    taskActionInFlight.current = true;
    const requestId = ++latestStatusRequest.current;
    setBusy(true);setMessage("");
    try {
      const next = await stopLegacy(platform);
      if (requestId === latestStatusRequest.current && currentPlatform.current === platform) setStatus(next);
      if (currentPlatform.current === platform) setMessage("已终止由学序启动的原版任务；请重新查询服务器学习记录。");
      onEvent?.("停止原版任务","success","已停止学序托管的原版进程");
    } catch(error) {
      if (currentPlatform.current === platform) setMessage(legacyError(error));
      onEvent?.("停止原版任务","warning",legacyError(error));
    }
    finally {
      taskActionInFlight.current = false;
      setBusy(false);
      if (currentPlatform.current === platform) void updateStatus();
    }
  }

  return <section className="legacy-playback-panel">
    <div className="section-head">
      <div><h3><Activity size={17}/> {platform === "zhidao" ? "知到" : "雨课堂"}原版心跳任务</h3>
      </div>
      <span className={status?.state === "running" ? "legacy-run-state active" : "legacy-run-state"}>
        {status ? labels[status.state] : desktop ? "状态未确认" : "仅 Windows 可运行"}
      </span>
    </div>
    <div className={"sf-live-progress-summary"+(platform==="zhidao"?" sf-has-zhs":"")+(detailMode?" sf-detail-simulation-only":"")} aria-label="运行状态、本地模拟片段和平台学习进度">
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
                ? status.course_id===selection
                  ? status.zhs_stale ? "本地进度输出已过期，等待新的原版输出" : "等待原版输出"
                  : "请选择正在运行的课程"
                : liveZhs ? "上次运行的最终采样" : "未获取到进度记录"}</small>}
          {status?.state==="running"&&status.course_id===selection&&status.zhs_stale&&
            <small role="status">任务进程仍在运行，但最近的本地进度采样已过期；不代表服务器学习失败或完成。</small>}
          {liveZhs?.resource_index!=null&&liveZhs.resource_total!=null&&
            <small>当前知识点资源 {liveZhs.resource_index}/{liveZhs.resource_total}</small>}
          {status?.state === "exited" && liveZhs &&
            <small>任务已结束 · 显示结束前最后一次真实采样</small>}
          <small>仅原版本地输出，非服务器确认进度</small>
        </div>}
      </div>
      {!detailMode&&<div className="sf-live-course-progress">
        <div className="sf-live-course-heading">
          <span>{platform==="yuketang"?"课程整体进度":"平台学习进度"}</span>
          <small>{verified.length>0?`已核验 ${verified.length} 门`:"暂无服务端核验数据"}</small>
        </div>
        {verified.length>0
          ?<div className="sf-verified-list">{verified.slice(0,4).map(({course,presentation})=>
            <div className="sf-verified-row" key={course.platform+":"+course.course_id}>
              <span title={course.title}>{course.title}</span>
              <div className="sf-verified-track" role="progressbar"
                aria-label={course.title+"平台已核验学习进度"}
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={presentation.percent??0}>
                <span style={{width:(presentation.percent??0)+"%"}}/>
              </div>
              <strong title={course.verified_at ? "服务器核验：" + course.verified_at : "服务器核验"}>
                {presentation.percent?.toFixed(1)}%
              </strong>
            </div>)}</div>
          :<div className="sf-unverified-note">{platform==="yuketang"?"课程整体进度暂无核验值；下方展示原版视频进度记录":"未接入可验证的实时百分比"}</div>}
      </div>}
    </div>
    {platform === "yuketang" && <div className={"sf-ykt-live"+(detailMode?" sf-detail-live":"")} aria-label="雨课堂原版实时进度">
      <div className="sf-ykt-live-title"><strong>雨课堂原版进度</strong>
        <small>{yktProgress?.available ? "本次任务日志 · 每 2 秒读取" : "本次任务尚无进度记录"}</small></div>
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
      <small className="sf-ykt-live-note">模拟位置不是已核验学习进度；并发模式下，原版日志未标识每条心跳所属视频，仅显示最新记录。</small>
    </div>}
    {platform === "zhidao"&&!detailMode&&<div className="legacy-field">
      <label htmlFor="legacy-zhidao-course">原版 ZHS 0.1.5 · 选择知到课程</label>
      <select id="legacy-zhidao-course" value={selection} onChange={e=>setSelection(e.target.value)}>
        <option value="">选择已同步的知到课程</option>
        {playableCourses.map(c=><option value={c.course_id} key={c.course_id}>{c.title}</option>)}
      </select>
    </div>}
    {platform === "zhidao"&&detailMode&&<div className="legacy-field sf-legacy-course-context">
      <span>当前运行课程</span><strong>{selectedCourse?.title??"课程未同步"}</strong>
    </div>}
    <div className="actions legacy-actions">
      <button className="primary" type="button" disabled={!desktop||!connected||busy||
        status?.state==="running"||
        (platform==="zhidao" && !playableCourses.some(c=>c.course_id===selection))||
        (platform==="yuketang" && (!settingsReady || !validateOriginalOptions(options)))}
        onClick={()=>void start()}><Play size={16}/> 启动原版任务</button>
      <button className="secondary" type="button" disabled={!desktop||busy||status?.state!=="running"}
        onClick={()=>void stop()}><Square size={16}/> 停止</button>
      <button className="secondary" type="button" disabled={!desktop||busy}
        onClick={()=>void updateStatus()}><RefreshCw size={16}/> 查询运行状态</button>
    </div>
    {status?.state==="exited"&&<p className="legacy-state-note">
      {legacyExitMessage(status)}（退出码：{status.exit_code ?? "未知"}）
      {platform==="zhidao"&&status.exit_code===0&&!status.zhs_progress&&
        <small>未采集到播放进度；请检查课程是否有可播放内容并使用服务端只读核验。</small>}
    </p>}
    {platform==="zhidao"&&verificationState!=="idle"&&
      <p className="legacy-state-note" role="status">
        {verificationState==="checking"?"正在只读核验当前课程的服务器记录…":
          verificationState==="verified"?"已读取当前课程的服务器学习记录；请以核验值判断是否完成。":
          "未确认当前课程的最新服务器记录；请在进度核验区手动重试。"}
      </p>}
    {message&&<p className="legacy-state-note" role="status">{message}</p>}
    <p className="legacy-disclaimer">平台进度以服务端核验结果为准。</p>
  </section>;
}
