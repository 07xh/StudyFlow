import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {ChevronDown,RefreshCw,Save,SlidersHorizontal} from "lucide-react";
import {friendlyBridgeError,request,type ZhidaoCourseDetail} from "../bridge";
import {originalZhsDefaults,validateZhsOptions,validateZhsStoredOptions,
  type OriginalZhsOptions,type ZhsStoredOptions} from "../legacyPlayback";
import type {TaskRecorder} from "../activity";

type ScopeMode="all"|"selected";
type Item={id:number;name:string;group:string;completed:boolean};
function itemId(detail:ZhidaoCourseDetail,item:ZhidaoCourseDetail["items"][number]){
  return detail.course_type==="ai"?item.knowledge_id:item.video_id;
}
function safeItems(detail:ZhidaoCourseDetail|null):Item[]{
  if(!detail?.verified||detail.stale)return [];
  return detail.items.flatMap(item=>{
    const id=itemId(detail,item);
    if(typeof id!=="number"||!Number.isSafeInteger(id)||id<=0)return [];
    return [{id,name:item.name,group:detail.course_type==="ai"?(item.theme||"其他知识点"):
      (item.chapter_name||"未分组章节"),completed:detail.course_type==="ai"?Boolean(item.fully_progressed):Boolean(item.server_completed)}];
  });
}
export function ZhsTaskSettingsPanel({desktop,courseId,courseType,onReady,onEvent}:{
  desktop:boolean;courseId:string;courseType?:"ai"|"shared"|null;
  onReady?:(options:OriginalZhsOptions|null)=>void;onEvent?:TaskRecorder;
}){
  const [options,setOptions]=useState<ZhsStoredOptions>({...originalZhsDefaults});
  const [saved,setSaved]=useState<ZhsStoredOptions|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [opened,setOpened]=useState(false);
  const [detail,setDetail]=useState<ZhidaoCourseDetail|null>(null);
  const [scopeMode,setScopeMode]=useState<ScopeMode>("all");
  const [selectedIds,setSelectedIds]=useState<number[]>([]);
  const revision=useRef(0);
  const readyRef=useRef(onReady);
  readyRef.current=onReady;
  const scopeKey="studyflow.zhs.task.scope."+courseId;
  const items=useMemo(()=>safeItems(detail),[detail]);
  const idsAvailable=useMemo(()=>new Set(items.map(item=>item.id)),[items]);
  const dirty=saved!==null&&JSON.stringify(options)!==JSON.stringify(saved);
  const valid=validateZhsStoredOptions(options);

  const ready=useMemo<OriginalZhsOptions|null>(()=>{
    if(!saved||busy||dirty||!valid||!courseId)return null;
    if(scopeMode==="selected" && (!items.length||!selectedIds.every(id=>idsAvailable.has(id))))return null;
    const result:OriginalZhsOptions={...saved,scope_mode:scopeMode,
      selected_ids:scopeMode==="selected"?selectedIds:[]};
    return validateZhsOptions(result)?result:null;
  },[saved,busy,dirty,valid,courseId,scopeMode,selectedIds,items,idsAvailable]);
  useEffect(()=>{readyRef.current?.(ready);},[ready]);

  const load=useCallback(async()=>{
    if(!desktop)return;
    const current=++revision.current;
    setBusy(true);setMessage("");
    try{
      const value=await request<ZhsStoredOptions>({operation:"zhidao.zhs.settings.get"});
      if(!validateZhsStoredOptions(value))throw new Error("INVALID_ZHS_SETTINGS");
      if(current===revision.current){setOptions(value);setSaved(value);}
    }catch(error){
      if(current===revision.current){setSaved(null);setMessage(friendlyBridgeError(error));}
    }finally{if(current===revision.current)setBusy(false);}
  },[desktop]);
  useEffect(()=>{void load();return ()=>{revision.current++;};},[load]);
  useEffect(()=>{
    setDetail(null);setScopeMode("all");setSelectedIds([]);
    if(!courseId)return;
    try{
      const stored=JSON.parse(window.localStorage.getItem(scopeKey)||"null");
      if(stored && (stored.mode==="all"||stored.mode==="selected")&&Array.isArray(stored.ids)&&
         stored.ids.length<=256 && stored.ids.every((id:unknown)=>typeof id==="number"&&Number.isSafeInteger(id)&&id>0)){
        setScopeMode(stored.mode);setSelectedIds([...new Set<number>(stored.ids)]);
      }
    }catch{/* Invalid local selection never becomes an execution option. */}
  },[scopeKey,courseId]);
  const fetchDetail=useCallback(async()=>{
    if(!desktop||!courseId)return;
    const key=courseId;
    try{
      const value=await request<ZhidaoCourseDetail>({operation:"zhidao.course.detail",course_key:key});
      if(value.course_key===key)setDetail(value);
    }catch(error){setMessage(friendlyBridgeError(error));}
  },[desktop,courseId]);
  useEffect(()=>{void fetchDetail();},[fetchDetail]);

  function persistScope(mode:ScopeMode,ids:number[]){
    setScopeMode(mode);setSelectedIds(ids);
    try{window.localStorage.setItem(scopeKey,JSON.stringify({mode,ids}));}catch{/* session-only */}
  }
  function update<K extends keyof ZhsStoredOptions>(key:K,value:ZhsStoredOptions[K]){
    setOptions(previous=>({...previous,[key]:value}));
  }
  async function save(){
    if(!desktop||busy||!valid||!dirty)return;
    setBusy(true);setMessage("");
    try{
      const result=await request<ZhsStoredOptions>({operation:"zhidao.zhs.settings.save",settings:options});
      if(!validateZhsStoredOptions(result))throw new Error("INVALID_ZHS_SETTINGS");
      setOptions(result);setSaved(result);setMessage("ZHS 参数已保存，下次启动任务时生效。");
      onEvent?.("保存 ZHS 参数","success","学序本机设置已保存");
    }catch(error){setMessage(friendlyBridgeError(error));onEvent?.("保存 ZHS 参数","warning","保存失败");}
    finally{setBusy(false);}
  }
  const groups=useMemo(()=>{
    const map=new Map<string,Item[]>();
    for(const item of items)map.set(item.group,[...(map.get(item.group)||[]),item]);
    return [...map.entries()];
  },[items]);

  return <div className="sf-inline-settings">
    <button type="button" className="sf-inline-settings__toggle" aria-expanded={opened} onClick={()=>setOpened(v=>!v)}>
      <SlidersHorizontal size={16}/><strong>ZHS 原版 · 观看控制</strong>
      <ChevronDown size={16} className={opened?"is-open":""}/>
    </button>
    {opened&&<section className="legacy-playback-panel sf-yuketang-settings-panel">
      <div className="section-head"><div><h3>ZHS 0.1.5 任务参数</h3></div>
        <span className="legacy-run-state">{saved?"本机参数已加载":"未读取参数"}</span></div>
      <div className="legacy-options">
        <div className="legacy-option-grid">
          <label><span>请求倍速（1–2×）</span>
            <input type="number" min={1} max={2} step={0.25} value={options.speed}
              disabled={!desktop||busy} onChange={e=>update("speed",Number(e.target.value))}/></label>
          <label><span>实际倍速上限（1–2×）</span>
            <input type="number" min={1} max={2} step={0.25} value={options.speed_cap}
              disabled={!desktop||busy} onChange={e=>update("speed_cap",Number(e.target.value))}/></label>
          <label><span>本次最多安排视频数（0 不限制）</span>
            <input type="number" min={0} max={1000} step={1} value={options.max_videos}
              disabled={!desktop||busy} onChange={e=>update("max_videos",Number(e.target.value))}/></label>
          <label><span>单次任务时间限制（分钟；0 沿用原版）</span>
            <input type="number" min={0} max={1440} step={1} value={options.limit_minutes}
              disabled={!desktop||busy} onChange={e=>update("limit_minutes",Number(e.target.value))}/></label>
        </div>
        <div className="legacy-flags">
          {courseType==="ai"&&<label><input type="checkbox" checked={options.learn_optional} disabled={!desktop||busy}
            onChange={e=>update("learn_optional",e.currentTarget.checked)}/>AI 课程包含选学资源</label>}
          <label><input type="checkbox" checked={options.stop_on_error} disabled={!desktop||busy}
            onChange={e=>update("stop_on_error",e.currentTarget.checked)}/>视频处理异常时停止任务</label>
        </div>
        <p className="sf-ykt-advanced-note">原版会跳过已完成视频；不提供无效的“强制重看”开关。共享课上游倍速含 ±0.15× 波动，学序会降低传入基准值以遵守上限。</p>
        <div className="legacy-option-grid">
          <label><span>本次执行范围</span>
            <select value={scopeMode} disabled={!desktop||!courseId}
              onChange={e=>persistScope(e.target.value as ScopeMode,selectedIds)}>
              <option value="all">整门课程</option>
              <option value="selected">指定章节 / 视频 / 知识点</option>
            </select>
          </label>
        </div>
        {scopeMode==="selected"&&<div className="sf-ykt-advanced-options">
          <div className="actions"><button className="secondary" type="button" disabled={!desktop}
            onClick={()=>void fetchDetail()}><RefreshCw size={14}/>刷新已核验目录</button>
            <span>{selectedIds.length} / 256 已选择</span></div>
          {!detail?.verified||detail.stale?<p className="sf-validation-error">需要当前账号已核验的课程目录；请先同步服务器进度再选择。</p>:
            <div className="legacy-options">
              {groups.map(([group,children])=><details key={group} className="sf-ykt-advanced-options">
                <summary>{group} · {children.length} 项</summary>
                <div className="legacy-flags">{children.map(item=><label key={item.id}>
                  <input type="checkbox" checked={selectedIds.includes(item.id)} disabled={!desktop||busy}
                    onChange={e=>{
                      const next=e.currentTarget.checked?[...selectedIds,item.id]:selectedIds.filter(id=>id!==item.id);
                      if(next.length<=256)persistScope("selected",next);
                    }}/>
                  {item.name}{item.completed?" · 已完成":""}
                </label>)}</div>
              </details>)}
              {groups.length===0&&<p>当前记录没有可识别的原始项目 ID，无法启动指定范围任务。</p>}
            </div>}
        </div>}
        {!valid&&<p className="sf-validation-error" role="alert">参数不在 ZHS 0.1.5 支持范围内。</p>}
        {scopeMode==="selected"&&!ready&&<p className="sf-validation-error">指定范围须至少选择一项真实、当前可核验的项目。</p>}
        {dirty&&<p className="sf-validation-error">有未保存的参数，保存后再启动任务。</p>}
        <div className="actions">
          <button className="secondary" type="button" disabled={!desktop||busy}
            onClick={()=>void load()}><RefreshCw size={15}/>重新读取</button>
          <button className="primary" type="button" disabled={!desktop||busy||!valid||!dirty}
            onClick={()=>void save()}><Save size={15}/>保存参数</button>
        </div>
        <details className="sf-ykt-advanced-options"><summary>心跳与进度说明</summary>
          <p className="sf-ykt-advanced-note">原版 ZHS 负责心跳实现；学序仅限制运行范围和次数。
          本地运行、任务退出、服务器已核验进度分别呈现，达到数量限制不代表课程完成。</p>
        </details>
      </div>
      {message&&<p className="legacy-state-note" role="status">{message}</p>}
    </section>}
  </div>;
}
