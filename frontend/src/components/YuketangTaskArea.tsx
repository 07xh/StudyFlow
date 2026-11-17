import type {ActivityEntry,TaskRecorder} from "../activity";
import {useCallback,useEffect,useRef,useState} from "react";
import {RefreshCw,Save,SlidersHorizontal} from "lucide-react";
import {friendlyBridgeError,request,type YuketangScope} from "../bridge";
import type {Course} from "../types";
import {LegacyPlaybackPanel} from "./LegacyPlaybackPanel";
import {
  originalYktDefaults,validateOriginalOptions,readYuketangCourseThreshold,saveYuketangCourseThreshold,type OriginalYktOptions
} from "../legacyPlayback";

type Props={
  courses:Course[];
  desktop:boolean;
  connected:boolean;
  onEvent?:TaskRecorder;
  detailMode?:boolean;
  events?:ActivityEntry[];
  view?:"player"|"settings";
};
export function YuketangTaskArea({courses,desktop,connected,onEvent,detailMode=false,events=[],view="player"}:Props){
  const [options,setOptions]=useState<OriginalYktOptions>({...originalYktDefaults});
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState<"load"|"save"|null>(null);
  const [message,setMessage]=useState("");
  const [scope,setScope]=useState<YuketangScope|null>(null);
  const [thresholdOverride,setThresholdOverride]=useState<number|null>(null);
  const onEventRef=useRef(onEvent);
  useEffect(()=>{onEventRef.current=onEvent;},[onEvent]);

  const load=useCallback(async()=>{
    if(!desktop)return;
    setBusy("load");setMessage("");
    try{
      const saved=await request<OriginalYktOptions>({operation:"yuketang.settings.get"});
      if(!validateOriginalOptions(saved))throw new Error("INVALID_YUKETANG_SETTINGS");
      // Old global values never propagate between independently configured classrooms.
      setOptions({...saved,completion_threshold:100});setLoaded(true);
      if(saved.completion_threshold!==100)
        setMessage("旧版全局阈值已设为保守默认 100%；可以在下方为当前课堂独立指定。");
    }catch(error){
      setLoaded(false);setMessage(friendlyBridgeError(error));
    }finally{setBusy(null);}
  },[desktop]);

  useEffect(()=>{void load();},[load]);
  const loadScope=useCallback(async()=>{
    if(!desktop)return;
    try {
      const current=await request<YuketangScope>({operation:"yuketang.scope.get"});
      if(!current.has_session||!/^[0-9]{1,24}$/.test(current.classroom_id)||
        !/^[0-9]{1,24}$/.test(current.university_id)){
        setScope(null);setThresholdOverride(null);return;
      }
      setScope(current);
      setThresholdOverride(readYuketangCourseThreshold(current.classroom_id,current.university_id));
    }catch{setScope(null);setThresholdOverride(null);}
  },[desktop]);
  const courseScopeSignature=courses.map(c=>c.course_id).join("|");
  useEffect(()=>{void loadScope();},[loadScope,courseScopeSignature]);
  // Settings are also editable in the platform modal while a course task stays mounted.
  // Re-read persisted options after a successful save so the next launch cannot use stale values.
  const latestSettingsSave=events.find(entry=>entry.platform==="雨课堂"&&
    entry.action==="保存原版参数"&&entry.result==="success")?.id;
  useEffect(()=>{if(latestSettingsSave){void load();void loadScope();}},[latestSettingsSave,load,loadScope]);

  function update<K extends keyof OriginalYktOptions>(key:K,value:OriginalYktOptions[K]){
    setOptions(previous=>({...previous,[key]:value}));
  }

  async function save(){
    if(!desktop||!validateOriginalOptions(options)||!(thresholdOverride===null||
      (Number.isInteger(thresholdOverride)&&thresholdOverride>=1&&thresholdOverride<=100)))return;
    setBusy("save");setMessage("");
    try{
      // A user may change classrooms while this settings dialog is open.
      // Never persist a per-classroom threshold under a stale classroom ID.
      const current=await request<YuketangScope>({operation:"yuketang.scope.get"});
      if(scope && (!current.has_session||current.classroom_id!==scope.classroom_id||
        current.university_id!==scope.university_id))
        throw new Error("YUKETANG_SCOPE_CHANGED");
      if(thresholdOverride!==null&&!scope)throw new Error("YUKETANG_SCOPE_UNAVAILABLE");
      const saved=await request<OriginalYktOptions>({
        operation:"yuketang.settings.save",settings:{...options,completion_threshold:100}
      });
      if(!validateOriginalOptions(saved))throw new Error("INVALID_YUKETANG_SETTINGS");
      if(scope)saveYuketangCourseThreshold(scope.classroom_id,scope.university_id,thresholdOverride);
      setOptions({...saved,completion_threshold:100});setLoaded(true);
      setMessage("参数已保存；当前课堂执行阈值与平台确认完成状态分别判断。");
      onEventRef.current?.("保存原版参数","success","参数已保存至学序本机配置");
    }catch(error){
      const detail=friendlyBridgeError(error);setMessage(detail);
      onEventRef.current?.("保存原版参数","warning",detail);
    }finally{setBusy(null);}
  }

  // The course workspace owns execution; the platform settings overlay owns configuration.
  if(view==="player")return <LegacyPlaybackPanel platform="yuketang" courses={courses} desktop={desktop}
    connected={connected} yuketangOptions={options} settingsReady={loaded}
    detailMode={detailMode} onEvent={onEvent} events={events}/>;
  return <section className="legacy-playback-panel sf-yuketang-settings-panel">
      <div className="section-head">
        <div><h3><SlidersHorizontal size={17}/>雨课堂默认参数</h3></div>
        <span className="legacy-run-state">{loaded?"已读取本机配置":"等待读取配置"}</span>
      </div>
      <div className="legacy-options">
        <h4 className="sf-settings-section-title">播放参数</h4>
        <div className="legacy-option-grid">
          {([
            ["video_speed","视频倍速（0.1–4×）",0.1,4,0.01],
            ["heartbeat_interval","心跳间隔（秒）",1,120,1],
            ["max_concurrent_videos","并发数量",1,32,1],
            ["test_video_count","测试视频数量",1,10000,1],
          ] as const).map(([id,label,min,max,step])=><label key={id}>
            <span>{label}</span>
            <input type="number" min={min} max={max} step={step}
              value={options[id]} disabled={!desktop||busy!==null}
              onChange={event=>update(id,Number(event.target.value))}/>
          </label>)}
        </div>
        <h4 className="sf-settings-section-title">完成规则</h4>
        <div className="legacy-option-grid">
          <label><span>当前课堂执行阈值</span>
            <select value={thresholdOverride===null?"auto":"custom"} disabled={!desktop||busy!==null||!scope}
              onChange={e=>setThresholdOverride(e.target.value==="auto"?null:100)}>
              <option value="auto">自动 · 保守默认 100%</option>
              <option value="custom">自定义当前课堂阈值</option>
            </select></label>
          {thresholdOverride!==null&&<label><span>执行目标（1–100%）</span>
            <input type="number" min={1} max={100} step={1} value={thresholdOverride}
              disabled={!desktop||busy!==null||!scope}
              onChange={e=>setThresholdOverride(Number(e.target.value))}/></label>}
        </div>
        {!scope&&<p className="sf-validation-error">请先连接课堂。</p>}
        <details className="sf-ykt-advanced-options"><summary>阈值说明{scope?" · 当前课堂 "+scope.classroom_id:""}</summary>
          <p className="sf-ykt-advanced-note">不同课堂可能要求不同进度。自动模式采用保守的 100% 本地执行目标；知道本课堂规则时可自定义。该数值只控制本地执行与跳过，不能替代平台实际完成状态；最终以服务器只读核验标志为准。</p>
        </details>
        <div className="legacy-flags">
          {([
            ["skip_completed","跳过已完成"],
            ["use_concurrent","原版并发模式"],
            ["test_mode","仅运行测试视频数量"],
            ["auto_richtext","保留原版图文处理"],
          ] as const).map(([id,label])=><label key={id}>
            <input type="checkbox" checked={options[id]} disabled={!desktop||busy!==null}
              onChange={event=>update(id,event.currentTarget.checked)}/>{label}
          </label>)}
        </div>
        <details className="sf-ykt-advanced-options">
          <summary>图文与诊断参数</summary>
          <div className="legacy-option-grid">
            <label>
              <span>每篇图文停留（秒）</span>
              <input type="number" min={0} max={3600} step={1}
                value={options.richtext_stay_seconds} disabled={!desktop||busy!==null}
                onChange={event=>update("richtext_stay_seconds",Number(event.target.value))}/>
            </label>
            <label>
              <span>图文间隔（秒）</span>
              <input type="number" min={0} max={3600} step={0.1}
                value={options.richtext_skip_delay} disabled={!desktop||busy!==null}
                onChange={event=>update("richtext_skip_delay",Number(event.target.value))}/>
            </label>
          </div>
          <div className="legacy-flags">
            <label>
              <input type="checkbox" checked={options.debug} disabled={!desktop||busy!==null}
                onChange={event=>update("debug",event.currentTarget.checked)}/>
              调试输出（仅本机日志）
            </label>
          </div>
          <p className="sf-ykt-advanced-note">沿用原版 DEBUG、RICHTEXT_STAY_SECONDS、RICHTEXT_SKIP_DELAY 配置；调试日志可能包含课程和视频标识，分享前请检查日志内容。</p>
        </details>
        {!validateOriginalOptions(options)&&<p className="sf-validation-error" role="alert">
          参数不在原版支持范围内，修正后才允许启动任务。
        </p>}
        <div className="actions">
          <button className="secondary" type="button" disabled={!desktop||busy!==null}
            onClick={()=>{void load();void loadScope();}}><RefreshCw size={15}/>{busy==="load"?"读取中…":"重新读取"}</button>
          <button className="primary" type="button" disabled={!desktop||!loaded||busy!==null||!validateOriginalOptions(options)||!(thresholdOverride===null||
              (Number.isInteger(thresholdOverride)&&thresholdOverride>=1&&thresholdOverride<=100))}
            onClick={()=>void save()}><Save size={15}/>{busy==="save"?"保存中…":"保存参数与课堂阈值"}</button>
        </div>
      </div>
      {message&&<p className="legacy-state-note" role="status">{message}</p>}
      <details className="sf-technical-note"><summary>参数作用范围</summary><p className="legacy-disclaimer">设置单独保存在雨课堂平台配置中；启动任务时由学序透传给原版执行器，不修改原版心跳逻辑。</p></details>
      </section>;
}
