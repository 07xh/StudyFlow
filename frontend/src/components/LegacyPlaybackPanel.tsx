import {useCallback, useEffect, useState} from "react";
import {Play, Square, RefreshCw, SlidersHorizontal, Activity} from "lucide-react";
import type {Course, Platform} from "../types";
import {presentCourse} from "../presentation";
import {
  getLegacyStatus, getYuketangLiveProgress, legacyError, originalYktDefaults, startLegacy, stopLegacy,
  validateOriginalOptions, type LegacyTaskStatus, type OriginalYktOptions, type YuketangLiveProgress
} from "../legacyPlayback";

const labels: Record<LegacyTaskStatus["state"], string> = {
  idle: "未启动", running: "原版进程运行中",
  exited: "原版进程已退出", stopped: "已终止"
};

function storedOptions(): OriginalYktOptions {
  try {
    const json = JSON.parse(window.localStorage.getItem("studyflow.ykt.original-options") || "null");
    if (json && typeof json === "object" && validateOriginalOptions(json as OriginalYktOptions))
      return json as OriginalYktOptions;
  } catch { /* No credentials or raw task results stored here. */ }
  return {...originalYktDefaults};
}

export function LegacyPlaybackPanel({
  platform, courses, desktop, connected, onEvent
}: {
  platform: Platform; courses: Course[]; desktop: boolean; connected: boolean;
  onEvent?: (action:string,result:"success"|"warning",detail:string)=>void;
}) {
  const [status, setStatus] = useState<LegacyTaskStatus | null>(null);
  const [yktProgress, setYktProgress] = useState<YuketangLiveProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState("");
  const [options, setOptions] = useState<OriginalYktOptions>(storedOptions);
  const aiCourses = courses.filter(c => c.platform === "zhidao" && c.course_type === "ai");
  const verified = courses.map(course => ({course, presentation: presentCourse(course)}))
    .filter(item => item.presentation.percent !== null);

  const updateStatus = useCallback(async () => {
    if (!desktop) return;
    try {
      const next = await getLegacyStatus(platform);
      setStatus(next);
      if (platform === "yuketang" && next.run_id) {
        try { setYktProgress(await getYuketangLiveProgress(next.run_id)); }
        catch { setYktProgress(null); }
      } else setYktProgress(null);
    } catch { setStatus(null);setYktProgress(null); }
  }, [desktop, platform]);

  useEffect(() => {
    void updateStatus();
    if (!desktop) return;
    const timer = window.setInterval(() => { void updateStatus(); }, 2000);
    return () => window.clearInterval(timer);
  }, [desktop, updateStatus]);

  function updateOption<K extends keyof OriginalYktOptions>(key: K, value: OriginalYktOptions[K]) {
    setOptions(current => {
      const next = {...current, [key]: value};
      // UI preferences only; session credentials remain in Windows Credential Manager.
      if (validateOriginalOptions(next)) {
        try {window.localStorage.setItem("studyflow.ykt.original-options", JSON.stringify(next));}
        catch {/* Persistence is optional. */}
      }
      return next;
    });
  }

  async function start() {
    setBusy(true); setMessage("");setYktProgress(null);
    try {
      const next = await startLegacy(platform, platform === "zhidao" ? selection : undefined,
        platform === "yuketang" ? options : undefined);
      setStatus(next);
      setMessage("已启动原版任务进程。进程运行不代表服务器已经接受心跳或确认学习进度。");
      onEvent?.("启动原版任务","success","原版进程已启动；服务端学习进度仍需单独核验");
    } catch (error) {setMessage(legacyError(error));onEvent?.("启动原版任务","warning",legacyError(error));}
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
      <div><h3><Activity size={17}/> {platform === "zhidao" ? "知到" : "雨课堂"}原版心跳任务</h3>
      </div>
      <span className={status?.state === "running" ? "legacy-run-state active" : "legacy-run-state"}>
        {status ? labels[status.state] : desktop ? "状态未确认" : "仅 Windows 可运行"}
      </span>
    </div>
    <div className="sf-live-progress-summary" aria-label="运行状态与已核验学习进度">
      <div className="sf-live-state">
        <span>任务运行状态</span>
        <strong>{status ? labels[status.state] : desktop ? "检测中" : "未连接桌面端"}</strong>
        <small>约每 2 秒更新</small>
      </div>
      <div className="sf-live-course-progress">
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
              <strong>{presentation.percent?.toFixed(1)}%</strong>
            </div>)}</div>
          :<div className="sf-unverified-note">{platform==="yuketang"?"课程整体进度暂无核验值；下方展示原版视频进度记录":"未接入可验证的实时百分比"}</div>}
      </div>
    </div>
    {platform === "yuketang" && <div className="sf-ykt-live" aria-label="雨课堂原版实时进度">
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
            yktProgress?.server_source==="initial"?"开始前查询":"等待服务器返回"}</small>
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
      </div>
      <small className="sf-ykt-live-note">模拟位置不是已核验学习进度；并发模式下，原版日志未标识每条心跳所属视频，仅显示最新记录。</small>
    </div>}
    {platform === "zhidao"
      ? <div className="legacy-field">
          <label htmlFor="legacy-zhidao-course">原版 ZHS 0.1.5 · 选择智慧课程</label>
          <select id="legacy-zhidao-course" value={selection} onChange={e=>setSelection(e.target.value)}>
            <option value="">选择已同步的智慧课程</option>
            {aiCourses.map(c=><option value={c.course_id} key={c.course_id}>{c.title}</option>)}
          </select>
        </div>
      : <div className="legacy-options">
          <h4><SlidersHorizontal size={16}/> 参数</h4>
          <div className="legacy-option-grid">
            {([
              ["video_speed","视频倍速",0.1,4,0.1],
              ["heartbeat_interval","心跳间隔（秒）",1,120,1],
              ["max_concurrent_videos","并发数量",1,32,1],
              ["completion_threshold","本地阈值（%）",0,100,1],
              ["test_video_count","测试视频数量",1,10000,1],
            ] as const).map(([id,label,min,max,step])=><label key={id}>
              <span>{label}</span>
              <input type="number" min={min} max={max} step={step} value={options[id]}
                onChange={event=>updateOption(id,Number(event.target.value))}/>
            </label>)}
          </div>
          <div className="legacy-flags">
            {([
              ["skip_completed","跳过已完成"],
              ["use_concurrent","原版并发模式"],
              ["test_mode","仅运行测试视频数量"],
              ["auto_richtext","保留原版图文处理"],
            ] as const).map(([id,label])=><label key={id}>
              <input type="checkbox" checked={options[id]}
                onChange={event=>updateOption(id,event.target.checked)}/>{label}
            </label>)}
          </div>
        </div>}
    <div className="actions legacy-actions">
      <button className="primary" type="button" disabled={!desktop||!connected||busy||
        status?.state==="running"||
        (platform==="zhidao" && !aiCourses.some(c=>c.course_id===selection))||
        (platform==="yuketang" && !validateOriginalOptions(options))}
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
