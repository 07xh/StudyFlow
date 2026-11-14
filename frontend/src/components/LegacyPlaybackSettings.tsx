import {useEffect,useState,type Dispatch,type SetStateAction} from "react";
import {SlidersHorizontal} from "lucide-react";
import {originalYktDefaults,validateOriginalOptions,type OriginalYktOptions} from "../legacyPlayback";

const storageKey="studyflow.ykt.original-options";
function loadStoredOptions():OriginalYktOptions {
  try {
    const json=JSON.parse(window.localStorage.getItem(storageKey)||"null");
    if(json&&typeof json==="object"&&validateOriginalOptions(json as OriginalYktOptions))
      return json as OriginalYktOptions;
  } catch {/* Invalid stored preferences must not break the platform page. */}
  return {...originalYktDefaults};
}

export function useOriginalYktOptions():readonly [
  OriginalYktOptions,Dispatch<SetStateAction<OriginalYktOptions>>
] {
  const [options,setOptions]=useState<OriginalYktOptions>(loadStoredOptions);
  useEffect(()=>{
    if(!validateOriginalOptions(options))return;
    try{window.localStorage.setItem(storageKey,JSON.stringify(options));}
    catch{/* Preferences remain usable for the current session. */}
  },[options]);
  return [options,setOptions] as const;
}

/** Platform-owned settings, separate from the original task launcher. */
export function LegacyPlaybackSettings({options,onChange}:{
  options:OriginalYktOptions;onChange:(next:OriginalYktOptions)=>void
}) {
  function updateOption<K extends keyof OriginalYktOptions>(key:K,value:OriginalYktOptions[K]){
    onChange({...options,[key]:value});
  }
  return <section className="legacy-playback-panel sf-platform-settings">
    <div className="section-head">
      <div><h3><SlidersHorizontal size={17}/> 雨课堂原版参数</h3>
        <p>此处单独管理雨课堂的原有任务设置，启动时直接传给原版执行器。</p></div>
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
            value={options[id]} onChange={event=>updateOption(id,Number(event.target.value))}/>
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
      {!validateOriginalOptions(options)&&<p className="sf-validation-error" role="alert">
        参数不在原版支持范围内，修正后才允许启动任务。
      </p>}
      <p className="legacy-disclaimer">
        参数仅在本机保存，不与知到共用；修改参数不会重写原版心跳实现。
      </p>
    </div>
  </section>;
}
