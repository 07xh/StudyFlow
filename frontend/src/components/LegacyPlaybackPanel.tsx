import {useCallback, useEffect, useState} from "react";
import {Play, Square, RefreshCw, SlidersHorizontal, Activity} from "lucide-react";
import type {Course, Platform} from "../types";
import {request,friendlyBridgeError} from "../bridge";
import {
  getLegacyStatus, legacyError, originalYktDefaults, startLegacy, stopLegacy,
  validateOriginalOptions, type LegacyTaskStatus, type OriginalYktOptions
} from "../legacyPlayback";

const labels: Record<LegacyTaskStatus["state"], string> = {
  idle: "未启动", running: "原版进程运行中",
  exited: "原版进程已退出", stopped: "已终止"
};

export function LegacyPlaybackPanel({
  platform, courses, desktop, connected, onEvent
}: {
  platform: Platform; courses: Course[]; desktop: boolean; connected: boolean;
  onEvent?: (action:string,result:"success"|"warning",detail:string)=>void;
}) {
  const [status, setStatus] = useState<LegacyTaskStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState("");
  const [options, setOptions] = useState<OriginalYktOptions>({...originalYktDefaults});
  const aiCourses = courses.filter(c => c.platform === "zhidao" && c.course_type === "ai");

  const updateStatus = useCallback(async () => {
    if (!desktop) return;
    try { setStatus(await getLegacyStatus(platform)); }
    catch { setStatus(null); }
  }, [desktop, platform]);

  useEffect(() => {
    void updateStatus();
    if (!desktop) return;
    const timer = window.setInterval(() => { void updateStatus(); }, 2000);
    return () => window.clearInterval(timer);
  }, [desktop, updateStatus]);

  useEffect(()=>{
    if(!desktop||platform!=="yuketang")return;
    let live=true;
    void request<OriginalYktOptions>({operation:"yuketang.settings.get"})
      .then(settings=>{if(live&&validateOriginalOptions(settings))setOptions(settings);})
      .catch(error=>{if(live)setMessage(friendlyBridgeError(error));});
    return ()=>{live=false;};
  },[desktop,platform]);

  function updateOption<K extends keyof OriginalYktOptions>(key:K,value:OriginalYktOptions[K]){
    setOptions(previous=>({...previous,[key]:value}));
  }

  async function saveOriginalSettings(){
    if(platform!=="yuketang"||!validateOriginalOptions(options))return;
    setBusy(true);setMessage("");
    try{
      const saved=await request<OriginalYktOptions>({operation:"yuketang.settings.save",settings:options});
      if(!validateOriginalOptions(saved))throw new Error("INVALID_IPC_RESPONSE");
      setOptions(saved);
      setMessage("已通过原版 exe_entry.py 保存雨课堂配置。");
      onEvent?.("保存原版参数","success","参数已保存至学序本机配置");
    }catch(error){
      const message=friendlyBridgeError(error);
      setMessage(message);onEvent?.("保存原版参数","warning",message);
    }finally{setBusy(false);}
  }

  async function start() {
    setBusy(true); setMessage("");
    try {
      if(platform==="yuketang"){
        await request<OriginalYktOptions>({operation:"yuketang.settings.save",settings:options});
      }
      const next = await startLegacy(platform, platform === "zhidao" ? selection : undefined,
        platform === "yuketang" ? options : undefined);
      setStatus(next);
      setMessage("已启动原版任务进程。进程运行不代表服务器已经接受心跳或确认学习进度。");
      onEvent?.("启动原版任务","success","原版进程已启动；服务端学习进度仍需单独核验");
    } catch (error) {
      const msg=error instanceof Error&&(error.message.includes("YUKETANG")||error.message==="INVALID_IPC_RESPONSE")
        ?friendlyBridgeError(error):legacyError(error);
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
      <div><h3><Activity size={17}/> {platform === "zhidao" ? "知到" : "雨课堂"}原版心跳任务</h3>
      </div>
      <span className={status?.state === "running" ? "legacy-run-state active" : "legacy-run-state"}>
        {status ? labels[status.state] : desktop ? "状态未确认" : "仅 Windows 可运行"}
      </span>
    </div>
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
          <div className="actions">
            <button className="secondary" type="button"
              disabled={!desktop||busy||!validateOriginalOptions(options)}
              onClick={()=>void saveOriginalSettings()}>保存原版参数</button>
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
