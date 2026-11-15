import {useCallback,useEffect,useRef,useState} from "react";
import {ChevronDown,RefreshCw,Save,SlidersHorizontal} from "lucide-react";
import {friendlyBridgeError,request} from "../bridge";
import {originalZhsDefaults,validateZhsOptions,type OriginalZhsOptions} from "../legacyPlayback";
import type {TaskRecorder} from "../activity";

export function ZhsTaskSettingsPanel({desktop,onReady,onEvent}:{
  desktop:boolean;onReady?:(options:OriginalZhsOptions|null)=>void;onEvent?:TaskRecorder;
}) {
  const [options,setOptions]=useState<OriginalZhsOptions>({...originalZhsDefaults});
  const [saved,setSaved]=useState<OriginalZhsOptions|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [opened,setOpened]=useState(false);
  const revision=useRef(0);
  const readyRef=useRef(onReady);
  readyRef.current=onReady;
  const load=useCallback(async()=>{
    if(!desktop)return;
    const current=++revision.current;
    setBusy(true);setMessage("");
    readyRef.current?.(null);
    try{
      const value=await request<OriginalZhsOptions>({operation:"zhidao.zhs.settings.get"});
      if(!validateZhsOptions(value))throw new Error("INVALID_ZHS_SETTINGS");
      if(current===revision.current){setOptions(value);setSaved(value);readyRef.current?.(value);}
    }catch(error){
      if(current===revision.current){setSaved(null);setMessage(friendlyBridgeError(error));}
    }finally{if(current===revision.current)setBusy(false);}
  },[desktop]);
  useEffect(()=>{void load();return()=>{revision.current++;readyRef.current?.(null);};},[load]);
  const dirty=saved!==null&&JSON.stringify(options)!==JSON.stringify(saved);
  const valid=validateZhsOptions(options);
  function update<K extends keyof OriginalZhsOptions>(key:K,value:OriginalZhsOptions[K]){
    const next={...options,[key]:value};
    setOptions(next);
    readyRef.current?.(saved&&JSON.stringify(next)===JSON.stringify(saved)?saved:null);
  }
  async function save(){
    if(!desktop||busy||!valid)return;
    setBusy(true);setMessage("");readyRef.current?.(null);
    try{
      const result=await request<OriginalZhsOptions>({operation:"zhidao.zhs.settings.save",settings:options});
      if(!validateZhsOptions(result))throw new Error("INVALID_ZHS_SETTINGS");
      setOptions(result);setSaved(result);readyRef.current?.(result);
      setMessage("ZHS 观看参数已保存；下次启动原版任务时生效。");
      onEvent?.("保存 ZHS 参数","success","ZHS 原版启动参数已保存");
    }catch(error){setMessage(friendlyBridgeError(error));onEvent?.("保存 ZHS 参数","warning","参数保存失败");}
    finally{setBusy(false);}
  }
  return <div className="sf-inline-settings">
    <button type="button" className="sf-inline-settings__toggle" aria-expanded={opened}
      onClick={()=>setOpened(v=>!v)}>
      <SlidersHorizontal size={16}/><strong>ZHS 原版观看参数</strong>
      <ChevronDown size={16} className={opened?"is-open":""}/>
    </button>
    {opened&&<section className="legacy-playback-panel sf-yuketang-settings-panel">
      <div className="section-head"><div><h3>知到 ZHS 0.1.5</h3></div>
        <span className="legacy-run-state">{saved?"已读取本机配置":"配置未就绪"}</span></div>
      <div className="legacy-options">
        <div className="legacy-option-grid">
          <label><span>观看倍速（1–2×）</span>
            <input type="number" min={1} max={2} step={0.25} value={options.speed}
              disabled={!desktop||busy} onChange={e=>update("speed",Number(e.target.value))}/></label>
          <label><span>单次观看时间限制（分钟；0 沿用原版设置）</span>
            <input type="number" min={0} max={1440} step={1} value={options.limit_minutes}
              disabled={!desktop||busy} onChange={e=>update("limit_minutes",Number(e.target.value))}/></label>
        </div>
        <div className="legacy-flags"><label>
          <input type="checkbox" checked={options.learn_optional} disabled={!desktop||busy}
            onChange={e=>update("learn_optional",e.currentTarget.checked)}/>
          AI 课程额外启用选学资源
        </label></div>
        <details className="sf-ykt-advanced-options"><summary>心跳与进度说明</summary>
          <p className="sf-ykt-advanced-note">ZHS 0.1.5 未提供公开的心跳间隔和并发参数；保持原版发送机制。
          当前任务本地输出与服务器只读核验分开展示。</p>
        </details>
        {!valid&&<p className="sf-validation-error" role="alert">ZHS 参数不在原版支持范围内。</p>}
        {dirty&&<p className="sf-validation-error">存在未保存修改，请保存后再启动任务。</p>}
        <div className="actions">
          <button type="button" className="secondary" disabled={!desktop||busy}
            onClick={()=>void load()}><RefreshCw size={15}/>重新读取</button>
          <button type="button" className="primary" disabled={!desktop||busy||!valid||!dirty}
            onClick={()=>void save()}><Save size={15}/>保存参数</button>
        </div>
      </div>
      {message&&<p className="legacy-state-note" role="status">{message}</p>}
      <p className="legacy-disclaimer">独立保存在学序本机目录；不覆盖 ZHS 或雨课堂原版配置。</p>
    </section>}
  </div>;
}
