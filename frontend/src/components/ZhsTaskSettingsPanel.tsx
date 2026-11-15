import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {RefreshCw,Save,SlidersHorizontal} from "lucide-react";
import {SettingsDialog} from "../ui/SettingsDialog";
import {friendlyBridgeError,request,type ZhidaoCourseDetail} from "../bridge";
import {originalZhsDefaults,validateZhsOptions,validateZhsStoredOptions,
  type OriginalZhsOptions,type ZhsStoredOptions} from "../legacyPlayback";
import type {TaskRecorder} from "../activity";

type ScopeMode="all"|"selected";
type ResourceMode="all"|"video"|"reading";
type Item={id:number;name:string;group:string;completed:boolean};
function itemId(detail:ZhidaoCourseDetail,item:ZhidaoCourseDetail["items"][number]){
  return detail.course_type==="ai"?item.knowledge_id:item.video_id;
}
function safeItems(detail:ZhidaoCourseDetail|null,courseId:string):Item[]{
  if(!detail?.verified||detail.stale||detail.course_key!==courseId)return [];
  return detail.items.flatMap(item=>{
    const id=itemId(detail,item);
    if(typeof id!=="number"||!Number.isSafeInteger(id)||id<=0)return [];
    return [{id,name:item.name,group:detail.course_type==="ai"?(item.theme||"其他知识点"):
      (item.chapter_name||"未分组章节"),completed:detail.course_type==="ai"?Boolean(item.fully_progressed):Boolean(item.server_completed)}];
  });
}
export function ZhsTaskSettingsPanel({desktop,dark=true,courseId,courseType,onReady,onEvent}:{
  desktop:boolean;dark?:boolean;courseId:string;courseType?:"ai"|"shared"|null;
  onReady?:(options:OriginalZhsOptions|null)=>void;onEvent?:TaskRecorder;
}){
  const [options,setOptions]=useState<ZhsStoredOptions>({...originalZhsDefaults});
  const [saved,setSaved]=useState<ZhsStoredOptions|null>(null);
  const [loadedFor,setLoadedFor]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [opened,setOpened]=useState(false);
  const [detail,setDetail]=useState<ZhidaoCourseDetail|null>(null);
  const [scopeMode,setScopeMode]=useState<ScopeMode>("all");
  const [resourceMode,setResourceMode]=useState<ResourceMode>("all");
  const [selectedIds,setSelectedIds]=useState<number[]>([]);
  const revision=useRef(0);
  const detailRevision=useRef(0);
  const readyRef=useRef(onReady);
  readyRef.current=onReady;
  const scopeKey="studyflow.zhs.task.scope."+courseId;
  const items=useMemo(()=>safeItems(detail,courseId),[detail,courseId]);
  const idsAvailable=useMemo(()=>new Set(items.map(item=>item.id)),[items]);
  const dirty=saved!==null&&JSON.stringify(options)!==JSON.stringify(saved);
  const valid=validateZhsStoredOptions(options);

  const ready=useMemo<OriginalZhsOptions|null>(()=>{
    if(!saved||busy||dirty||!valid||!courseId||loadedFor!==courseId)return null;
    if(scopeMode==="selected" && (!items.length||!selectedIds.every(id=>idsAvailable.has(id))))return null;
    if(courseType!=="ai" && resourceMode==="reading")return null;
    const result:OriginalZhsOptions={...saved,scope_mode:scopeMode,resource_mode:resourceMode,
      selected_ids:scopeMode==="selected"?selectedIds:[]};
    return validateZhsOptions(result)?result:null;
  },[saved,busy,dirty,valid,courseId,loadedFor,courseType,scopeMode,resourceMode,selectedIds,items,idsAvailable]);
  useEffect(()=>{readyRef.current?.(ready);},[ready]);

  const load=useCallback(async()=>{
    if(!desktop)return;
    const current=++revision.current;
    setBusy(true);setMessage("");setLoadedFor("");
    try{
      const value=await request<ZhsStoredOptions>({operation:"zhidao.zhs.settings.get",course_key:courseId||undefined});
      if(!validateZhsStoredOptions(value))throw new Error("INVALID_ZHS_SETTINGS");
      if(current===revision.current){setOptions(value);setSaved(value);setLoadedFor(courseId);}
    }catch(error){
      if(current===revision.current){setSaved(null);setLoadedFor("");setMessage(friendlyBridgeError(error));}
    }finally{if(current===revision.current)setBusy(false);}
  },[desktop,courseId]);
  useEffect(()=>{void load();return ()=>{revision.current++;};},[load]);
  useEffect(()=>{
    setDetail(null);setScopeMode("all");setResourceMode("all");setSelectedIds([]);
    if(!courseId)return;
    try{
      const stored=JSON.parse(window.localStorage.getItem(scopeKey)||"null");
      if(stored && (stored.mode==="all"||stored.mode==="selected")&&Array.isArray(stored.ids)&&
         stored.ids.length<=256 && stored.ids.every((id:unknown)=>typeof id==="number"&&Number.isSafeInteger(id)&&id>0)){
        setScopeMode(stored.mode);setSelectedIds([...new Set<number>(stored.ids)]);
        if(stored.resourceMode==="all"||stored.resourceMode==="video"||
            (stored.resourceMode==="reading"&&courseType==="ai")){
          setResourceMode(stored.resourceMode);
        }
      }
    }catch{/* Invalid local selection never becomes an execution option. */}
  },[scopeKey,courseId,courseType]);
  const fetchDetail=useCallback(async()=>{
    if(!desktop||!courseId)return;
    const key=courseId,seq=++detailRevision.current;
    try{
      const value=await request<ZhidaoCourseDetail>({operation:"zhidao.course.detail",course_key:key});
      if(seq===detailRevision.current&&value.course_key===key)setDetail(value);
    }catch(error){
      if(seq===detailRevision.current)setMessage(friendlyBridgeError(error));
    }
  },[desktop,courseId]);
  useEffect(()=>{void fetchDetail();return ()=>{detailRevision.current++;};},[fetchDetail]);

  function persistScope(mode:ScopeMode,ids:number[],kind:ResourceMode=resourceMode){
    setScopeMode(mode);setSelectedIds(ids);setResourceMode(kind);
    try{window.localStorage.setItem(scopeKey,JSON.stringify({mode,ids,resourceMode:kind}));}catch{/* session-only */}
  }
  function update<K extends keyof ZhsStoredOptions>(key:K,value:ZhsStoredOptions[K]){
    setOptions(previous=>({...previous,[key]:value}));
  }
  async function save(){
    if(!desktop||busy||!valid||!dirty)return;
    setBusy(true);setMessage("");
    try{
      const result=await request<ZhsStoredOptions>({operation:"zhidao.zhs.settings.save",course_key:courseId||undefined,settings:options});
      if(!validateZhsStoredOptions(result))throw new Error("INVALID_ZHS_SETTINGS");
      setOptions(result);setSaved(result);setLoadedFor(courseId);setMessage("当前课程 ZHS 参数已保存，下次启动任务时生效。");
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
    <button type="button" className="sf-inline-settings__toggle" aria-expanded={opened}
      onClick={()=>setOpened(true)}>
      <SlidersHorizontal size={16}/><strong>ZHS 原版 · 观看控制</strong>
      <span className="sf-muted">点击设置</span>
    </button>
    <SettingsDialog open={opened} dark={dark} title="当前课程 · ZHS 参数"
      onClose={()=>setOpened(false)}>
      <section className="legacy-playback-panel sf-yuketang-settings-panel">
      <div className="section-head"><div><h3>ZHS 0.1.5 任务参数</h3></div>
        <span className="legacy-run-state">{saved?"本机参数已加载":"未读取参数"}</span></div>
      <div className="legacy-options">
        <div className="legacy-option-grid">
          <label><span>同课程视频并发数</span>
            <select value={options.concurrency??1} disabled={!desktop||busy}
              onChange={e=>update("concurrency",Number(e.target.value))}>
              <option value={1}>1 · 单路顺序执行</option>
              <option value={2}>2 · 双路并发（默认）</option>
              <option value={3}>3 · 三路并发</option>
            </select></label>
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
          <label><span>当前课程执行完成阈值</span>
            <select value={options.completion_threshold===null?"auto":"custom"}
              disabled={!desktop||busy}
              onChange={e=>update("completion_threshold",e.target.value==="auto"?null:100)}>
              <option value="auto">自动（沿用原版课程类型规则）</option>
              <option value="custom">手动设置（仅当前课程）</option>
            </select></label>
          {options.completion_threshold!==null&&<label><span>执行目标（1–100%）</span>
            <input type="number" min={1} max={100} step={1} value={options.completion_threshold}
              disabled={!desktop||busy}
              onChange={e=>update("completion_threshold",Number(e.target.value))}/></label>}
        </div>
        <p className="sf-ykt-advanced-note">并发仅作用于本门课的视频，每个视频独立显示进度并可单独停止。文章和 PPT 顺序处理；课程完成情况以服务器核验为准。</p>
        <div className="legacy-flags">
          <label title="ZHS 0.1.5 原版自动跳过已完成内容，暂不支持在学序中关闭此行为。">
            <input type="checkbox" checked readOnly disabled aria-label="跳过已完成（原版自动启用）"/>
            跳过已完成 <small className="sf-muted">（原版自动启用）</small>
          </label>
          {courseType==="ai"&&<label><input type="checkbox" checked={options.learn_optional} disabled={!desktop||busy}
            onChange={e=>update("learn_optional",e.currentTarget.checked)}/>AI 课程包含选学资源</label>}
          <label><input type="checkbox" checked={options.stop_on_error} disabled={!desktop||busy}
            onChange={e=>update("stop_on_error",e.currentTarget.checked)}/>视频处理异常时停止任务</label>
        </div>
        <p className="sf-ykt-advanced-note">本课程默认继承 ZHS 原版对不同课程类型的执行阈值。自定义百分比只控制本地执行目标，不代表平台已经确认完成；平台仍返回未完成时，界面不会标为完成。阈值随课程独立保存。“跳过已完成”由 ZHS 0.1.5 原版自动执行；共享课上游倍速含 ±0.15× 波动，学序会降低传入基准值以遵守上限。</p>
        <div className="legacy-option-grid">
          <label><span>本次选择的资源类型</span>
            <select value={resourceMode} disabled={!desktop||!courseId||busy}
              onChange={e=>persistScope(scopeMode,selectedIds,e.target.value as ResourceMode)}>
              <option value="all">全部资源（原版处理顺序）</option>
              <option value="video">只选择视频 / 课程视频</option>
              {courseType==="ai"&&<option value="reading">只选择文章 / PPT（AI 课程）</option>}
            </select>
          </label>
          <label><span>本次执行范围</span>
            <select value={scopeMode} disabled={!desktop||!courseId}
              onChange={e=>persistScope(e.target.value as ScopeMode,selectedIds)}>
              <option value="all">整门课程</option>
              <option value="selected">指定章节 / 视频 / 知识点</option>
            </select>
          </label>
        </div>
        <p className="sf-ykt-advanced-note">仅针对当前课程的真实资源选择类型，不更改 ZHS 原版的发送节奏。视频比例是单个片段位置，切换视频或知识点时可从 0 开始；课程总体进度以服务器核验为准。停止后再次启动会创建新的原版进程，不会续用已停止的进程。</p>
        {scopeMode==="selected"&&<div className="sf-ykt-advanced-options">
          <div className="actions"><button className="secondary" type="button" disabled={!desktop}
            onClick={()=>void fetchDetail()}><RefreshCw size={14}/>刷新已核验目录</button>
            <span>{selectedIds.length} / 256 已选择</span></div>
          {!detail?.verified||detail.stale?<p className="sf-validation-error">需要当前账号已核验的课程目录；请先同步服务器进度再选择。</p>:
            <div className="legacy-options">
              {groups.map(([group,children])=><details key={group} className="sf-ykt-advanced-options">
                <summary>{group} · {children.length} 项</summary>
                <div className="actions"><button className="secondary" type="button" disabled={!desktop||busy}
                  onClick={()=>{
                    const groupIds=children.filter(item=>!item.completed).map(item=>item.id);
                    const all=groupIds.every(id=>selectedIds.includes(id));
                    const next=all?selectedIds.filter(id=>!groupIds.includes(id)):
                      [...new Set([...selectedIds,...groupIds])];
                    if(next.length<=256)persistScope("selected",next);
                    else setMessage("选择数量不得超过 256 项。");
                  }}>切换本组未完成项目</button></div>
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
      </section>
    </SettingsDialog>
  </div>;
}
