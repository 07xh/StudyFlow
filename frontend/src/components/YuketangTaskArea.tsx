import {useCallback,useEffect,useRef,useState} from "react";
import {RefreshCw,Save,SlidersHorizontal} from "lucide-react";
import {friendlyBridgeError,request} from "../bridge";
import type {Course} from "../types";
import {LegacyPlaybackPanel} from "./LegacyPlaybackPanel";
import {
  originalYktDefaults,validateOriginalOptions,type OriginalYktOptions
} from "../legacyPlayback";

type Props={
  courses:Course[];
  desktop:boolean;
  connected:boolean;
  onEvent?:(action:string,result:"success"|"warning",detail:string)=>void;
  detailMode?:boolean;
};
export function YuketangTaskArea({courses,desktop,connected,onEvent,detailMode=false}:Props){
  const [options,setOptions]=useState<OriginalYktOptions>({...originalYktDefaults});
  const [loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState<"load"|"save"|null>(null);
  const [message,setMessage]=useState("");
  const onEventRef=useRef(onEvent);
  useEffect(()=>{onEventRef.current=onEvent;},[onEvent]);

  const load=useCallback(async()=>{
    if(!desktop)return;
    setBusy("load");setMessage("");
    try{
      const saved=await request<OriginalYktOptions>({operation:"yuketang.settings.get"});
      if(!validateOriginalOptions(saved))throw new Error("INVALID_YUKETANG_SETTINGS");
      setOptions(saved);setLoaded(true);
    }catch(error){
      setLoaded(false);setMessage(friendlyBridgeError(error));
    }finally{setBusy(null);}
  },[desktop]);

  useEffect(()=>{void load();},[load]);

  function update<K extends keyof OriginalYktOptions>(key:K,value:OriginalYktOptions[K]){
    setOptions(previous=>({...previous,[key]:value}));
  }

  async function save(){
    if(!desktop||!validateOriginalOptions(options))return;
    setBusy("save");setMessage("");
    try{
      const saved=await request<OriginalYktOptions>({
        operation:"yuketang.settings.save",settings:options
      });
      if(!validateOriginalOptions(saved))throw new Error("INVALID_YUKETANG_SETTINGS");
      setOptions(saved);setLoaded(true);
      setMessage("雨课堂原版参数已保存到学序本机配置，并将在下次启动时透传给原版执行器。");
      onEventRef.current?.("保存原版参数","success","参数已保存至学序本机配置");
    }catch(error){
      const detail=friendlyBridgeError(error);setMessage(detail);
      onEventRef.current?.("保存原版参数","warning",detail);
    }finally{setBusy(null);}
  }

  return <>
    <section className="legacy-playback-panel sf-yuketang-settings-panel">
      <div className="section-head">
        <div><h3><SlidersHorizontal size={17}/>雨课堂原版参数</h3></div>
        <span className="legacy-run-state">{loaded?"已读取本机配置":"等待读取配置"}</span>
      </div>
      <div className="legacy-options">
        <div className="legacy-option-grid">
          {([
            ["video_speed","视频倍速",0.1,4,0.1],
            ["heartbeat_interval","心跳间隔（秒）",1,120,1],
            ["max_concurrent_videos","并发数量",1,32,1],
            ["completion_threshold","本地阈值（%）",0,100,1],
            ["test_video_count","测试视频数量",1,10000,1],
          ] as const).map(([id,label,min,max,step])=><label key={id}>
            <span>{label}</span>
            <input type="number" min={min} max={max} step={step}
              value={options[id]} disabled={!desktop||busy!==null}
              onChange={event=>update(id,Number(event.target.value))}/>
          </label>)}
        </div>
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
        <details className="sf-ykt-advanced-options" open={detailMode}>
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
            onClick={()=>void load()}><RefreshCw size={15}/>{busy==="load"?"读取中…":"重新读取"}</button>
          <button className="primary" type="button" disabled={!desktop||!loaded||busy!==null||!validateOriginalOptions(options)}
            onClick={()=>void save()}><Save size={15}/>{busy==="save"?"保存中…":"保存参数"}</button>
        </div>
      </div>
      {message&&<p className="legacy-state-note" role="status">{message}</p>}
      <p className="legacy-disclaimer">设置单独保存在雨课堂平台配置中；启动任务时由学序透传给原版执行器，不修改原版心跳逻辑。</p>
    </section>
    <LegacyPlaybackPanel platform="yuketang" courses={courses} desktop={desktop}
      connected={connected} yuketangOptions={options} settingsReady={loaded}
      detailMode={detailMode} onEvent={onEvent}/>
  </>;
}
