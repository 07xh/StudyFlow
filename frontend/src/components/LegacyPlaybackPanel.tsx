import {useCallback,useEffect,useState} from "react";
import {Play,Square,RefreshCw,SlidersHorizontal,Activity} from "lucide-react";
import type {Course,Platform} from "../types";
import {
  getLegacyStatus,legacyError,originalYktDefaults,startLegacy,stopLegacy,
  validateOriginalOptions,type LegacyTaskStatus,type OriginalYktOptions
} from "../legacyPlayback";

const labels:Record<LegacyTaskStatus["state"],string>={
  idle:"未启动",running:"运行中",exited:"已退出",stopped:"已停止"
};

function storedOptions():OriginalYktOptions{
  try{
    const json=JSON.parse(window.localStorage.getItem("studyflow.ykt.original-options")||"null");
    if(json&&typeof json==="object"&&validateOriginalOptions(json as OriginalYktOptions))
      return json as OriginalYktOptions;
  }catch{/* No credentials or task results are stored here. */}
  return {...originalYktDefaults};
}

export function LegacyPlaybackPanel({platform,courses,desktop,connected}:{
  platform:Platform;courses:Course[];desktop:boolean;connected:boolean
}){
  const [status,setStatus]=useState<LegacyTaskStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [selection,setSelection]=useState("");
  const [options,setOptions]=useState<OriginalYktOptions>(storedOptions);
  const aiCourses=courses.filter(c=>c.platform==="zhidao"&&c.course_type==="ai");

  const updateStatus=useCallback(async()=>{
    if(!desktop)return;
    try{setStatus(await getLegacyStatus(platform));}
    catch{setStatus(null);}
  },[desktop,platform]);

  useEffect(()=>{
    void updateStatus();
    if(!desktop)return;
    const timer=window.setInterval(()=>{void updateStatus();},2000);
    return ()=>window.clearInterval(timer);
  },[desktop,updateStatus]);

  function updateOption<K extends keyof OriginalYktOptions>(key:K,value:OriginalYktOptions[K]){
    setOptions(current=>{
      const next={...current,[key]:value};
      if(validateOriginalOptions(next)){
        try{window.localStorage.setItem("studyflow.ykt.original-options",JSON.stringify(next));}
        catch{/* Preference persistence is optional. */}
      }
      return next;
    });
  }

  async function start(){
    setBusy(true);setMessage("");
    try{
      const next=await startLegacy(platform,platform==="zhidao"?selection:undefined,
        platform==="yuketang"?options:undefined);
      setStatus(next);setMessage("已启动。");
    }catch(error){setMessage(legacyError(error));}
    finally{setBusy(false);}
  }

  async function stop(){
    setBusy(true);setMessage("");
    try{setStatus(await stopLegacy(platform));setMessage("已停止。");}
    catch(error){setMessage(legacyError(error));}
    finally{setBusy(false);}
  }

  return <section className="legacy-playback-panel">
    <div className="section-head">
      <h3><Activity size={16}/>{platform==="zhidao"?"知到":"雨课堂"}原版任务</h3>
      <span className={status?.state==="running"?"legacy-run-state active":"legacy-run-state"}>
        <span className="sf-status-dot"/>{status?labels[status.state]:desktop?"状态未确认":"仅桌面端可运行"}
      </span>
    </div>
    {platform==="zhidao"
      ?<div className="legacy-field">
          <label htmlFor="legacy-zhidao-course">智慧课程</label>
          <select id="legacy-zhidao-course" value={selection} onChange={event=>setSelection(event.target.value)}>
            <option value="">选择已同步课程</option>
            {aiCourses.map(course=><option value={course.course_id} key={course.course_id}>{course.title}</option>)}
          </select>
        </div>
      :<div className="legacy-options">
          <h4><SlidersHorizontal size={15}/>参数</h4>
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
              ["use_concurrent","并发模式"],
              ["test_mode","测试模式"],
              ["auto_richtext","图文处理"],
            ] as const).map(([id,label])=><label key={id}>
              <input type="checkbox" checked={options[id]}
                onChange={event=>updateOption(id,event.target.checked)}/>{label}
            </label>)}
          </div>
        </div>}
    <div className="actions legacy-actions">
      <button className="primary" type="button" disabled={!desktop||!connected||busy||
        status?.state==="running"||
        (platform==="zhidao"&&!aiCourses.some(course=>course.course_id===selection))||
        (platform==="yuketang"&&!validateOriginalOptions(options))}
        onClick={()=>void start()}><Play size={15}/>启动</button>
      <button className="secondary" type="button" disabled={!desktop||busy||status?.state!=="running"}
        onClick={()=>void stop()}><Square size={15}/>停止</button>
      <button className="secondary" type="button" disabled={!desktop||busy}
        onClick={()=>void updateStatus()}><RefreshCw size={15}/>查询状态</button>
    </div>
    {status?.state==="exited"&&<p className="legacy-state-note">
      进程退出码：{status.exit_code??"未知"}
    </p>}
    {message&&<p className="legacy-state-note" role="status">{message}</p>}
    <p className="legacy-disclaimer">本地进程状态不代表平台已确认进度。</p>
  </section>;
}
