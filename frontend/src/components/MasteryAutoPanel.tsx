import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {sameStatusSnapshot} from "../statusSnapshot";
import {Pause,Play,RotateCcw,Square,CheckCircle2,RefreshCw,ChevronDown,BookOpen,Layers3} from "lucide-react";
import {
  masteryAutoControl,masteryAutoStart,masteryAutoStatus,masteryCatalog,friendlyBridgeError,
  questionBankList,type QuestionBankState,type MasteryKnowledge,
  type MasteryAutoSettings,type MasteryAutoStatus,
} from "../bridge";
import "./MasteryAutoPanel.css";

const DEFAULT:MasteryAutoSettings={
  target:100,max_rounds:12,stagnation_rounds:3,max_minutes:180,
  first_round_mode:"bank_only",max_ai_calls:30,
  use_external_bank:false,external_provider_id:"yanxi",
  external_token_id:"",max_external_calls:40,
  scope_mode:"all",chapter_count:1,chapter_indices:[],
};
const IDLE:MasteryAutoStatus={
  state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[],
};
const ACTIVE=new Set(["starting","running","pausing","paused","stopping"]);
// Mirror the Python start() bounds so invalid edits never reach the native IPC.
const NUMBER_LIMITS={
  target:{min:1,max:100,label:"目标分数"},
  max_rounds:{min:1,max:30,label:"每知识点最多轮次"},
  stagnation_rounds:{min:1,max:10,label:"连续不涨分停止"},
  max_minutes:{min:1,max:720,label:"最长运行（分钟）"},
  max_ai_calls:{min:1,max:100,label:"AI 调用上限"},
  max_external_calls:{min:1,max:200,label:"外部查询次数上限"},
} as const;
type NumberLimitKey=keyof typeof NUMBER_LIMITS;
// Timestamps are diagnostic metadata, not a change to displayed task progress.
const NON_VISUAL_FIELDS=new Set(["updated_at"]);
const LABEL:Record<string,string>={
  idle:"未开始",starting:"准备中",running:"后台运行中",pausing:"完成当前知识点后暂停",paused:"已暂停",
  stopping:"正在停止",stopped:"已停止",completed:"本次扫描完成",
  error:"运行出错",interrupted:"上次任务中断",needs_attention:"需核验提交状态",
};

export function MasteryAutoPanel({courseKey,desktop}:{
  courseKey:string;desktop:boolean;
}){
  const [status,setStatus]=useState<MasteryAutoStatus>(IDLE);
  const latestStatus=useRef<MasteryAutoStatus>(IDLE);
  // Distinguish individual visits, not only course IDs: A -> B -> A must
  // discard the first A visit's in-flight responses as well.
  const sessionRef=useRef({courseKey,revision:0});
  if(sessionRef.current.courseKey!==courseKey){
    sessionRef.current={courseKey,revision:sessionRef.current.revision+1};
  }
  const revision=sessionRef.current.revision;
  const isCurrent=useCallback(
    ()=>sessionRef.current.courseKey===courseKey&&sessionRef.current.revision===revision,
    [courseKey,revision],
  );
  const applyStatus=useCallback((value:MasteryAutoStatus)=>{
    if(!isCurrent()||(value.course_key&&value.course_key!==courseKey))return;
    // Do not call React's state setter at all if the backend only changes
    // its bookkeeping timestamp. This also protects a long knowledge list.
    if(sameStatusSnapshot(latestStatus.current,value,NON_VISUAL_FIELDS))return;
    latestStatus.current=value;
    setStatus(value);
  },[courseKey,isCurrent]);
  const [settings,setSettings]=useState<MasteryAutoSettings>(DEFAULT);
  const [busy,setBusy]=useState(false);
  const [aiKey,setAiKey]=useState("");
  const [bankState,setBankState]=useState<QuestionBankState>({providers:[],tokens:[]});
  const [bankError,setBankError]=useState("");
  const [chapters,setChapters]=useState<Array<{index:number;name:string;count:number}>>([]);
  const [chapterLoading,setChapterLoading]=useState(false);
  const [chapterError,setChapterError]=useState("");
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [error,setError]=useState("");
  const statusVersion=useRef(0);
  const statusInFlight=useRef<Set<string>>(new Set());
  const refresh=useCallback(async()=>{
    // Status polls started before a Start/Pause/Resume/Stop result are stale.
    // A new version can read immediately even if an old poll is still hung.
    const version=statusVersion.current;
    const flight=`${revision}:${version}`;
    if(!desktop||!isCurrent()||statusInFlight.current.has(flight))return;
    statusInFlight.current.add(flight);
    let timeoutId:number|undefined;
    try{
      // One native status read at a time. Without this guard, a slow sidecar
      // queues extra calls every 2.5 s and makes the dialog feel frozen.
      const value=await Promise.race<MasteryAutoStatus>([
        masteryAutoStatus(courseKey),
        new Promise<never>((_,reject)=>{
          timeoutId=window.setTimeout(()=>reject(new Error("掌握度状态读取超时，可手动刷新。")),15000);
        })
      ]);
      if(isCurrent()&&version===statusVersion.current){
        applyStatus(value);
        setError(previous=>previous?"":previous);
      }
    }catch(cause){
      if(isCurrent()&&version===statusVersion.current){
        const message=friendlyBridgeError(cause);
        setError(previous=>previous===message?previous:message);
      }
    }finally{
      if(timeoutId!==undefined)window.clearTimeout(timeoutId);
      statusInFlight.current.delete(flight);
    }
  },[desktop,applyStatus,isCurrent,revision]);

  useEffect(()=>{
    // Keep a prior course's task, errors and selected chapters out of the
    // newly opened course while its first read is still in flight.
    latestStatus.current=IDLE;
    setStatus(IDLE);
    setError("");
    setChapters([]);
    setChapterError("");
    setChapterLoading(false);
    setDetailsOpen(false);
    setBusy(false);
    setAiKey("");
    statusVersion.current+=1;
    setSettings(previous=>({...previous,chapter_indices:[]}));
    if(!desktop)return;
    void refresh();
    // Polling is read-only, single-flight, and skips unchanged React renders.
    const timer=window.setInterval(()=>{void refresh();},2500);
    (timer as unknown as {unref?:()=>void}).unref?.();
    return ()=>window.clearInterval(timer);
  },[desktop,refresh]);

  const reloadBanks=useCallback(async()=>{
    if(!desktop)return;
    try{
      const state=await questionBankList();
      setBankState(state);
      setBankError("");
      setSettings(previous=>{
        const provider=state.providers.some(p=>p.id===previous.external_provider_id)
          ?previous.external_provider_id||"" :state.providers[0]?.id||"";
        const valid=state.tokens.some(t=>t.provider_id===provider&&t.id===previous.external_token_id);
        const token=valid?previous.external_token_id:"";
        return {...previous,external_provider_id:provider,external_token_id:token};
      });
    }catch(cause){setBankError(friendlyBridgeError(cause));}
  },[desktop]);
  useEffect(()=>{void reloadBanks();},[reloadBanks]);

  const chapterRequestId=useRef(0);
  const reloadChapters=useCallback(async()=>{
    if(!desktop||!isCurrent())return;
    const requestId=++chapterRequestId.current;
    const ownsRequest=()=>isCurrent()&&chapterRequestId.current===requestId;
    setChapterLoading(true);setChapterError("");
    try{
      // Read only the chapter catalog, not 147 per-point mastery statistics or a paper.
      const catalog=await masteryCatalog(courseKey,false,false);
      if(!ownsRequest())return;
      const groups:Array<{index:number;name:string;count:number}>=[];
      let previousTheme:string|null=null;
      let index=0;
      for(const item of catalog.knowledge as MasteryKnowledge[]){
        if(typeof item.chapter_index==="number"&&item.chapter_index>=1)
          index=item.chapter_index;
        else if(item.theme!==previousTheme)index+=1;
        const last=groups[groups.length-1];
        if(last?.index===index)last.count+=1;
        else groups.push({index,name:item.theme||"第"+index+"章",count:1});
        previousTheme=item.theme;
      }
      setChapters(groups);
      setSettings(previous=>{
        if(previous.chapter_indices?.length)return previous;
        return {...previous,chapter_indices:groups.length?[groups[0].index]:[]};
      });
    }catch(cause){
      if(ownsRequest())setChapterError(friendlyBridgeError(cause));
    }finally{
      if(ownsRequest())setChapterLoading(false);
    }
  },[courseKey,desktop,isCurrent]);
  useEffect(()=>{void reloadChapters();},[reloadChapters]);

  const configuredBankTokens=bankState.tokens.filter(t=>t.provider_id===settings.external_provider_id);
  const missingExternalToken=Boolean(settings.use_external_bank)&&
    (configuredBankTokens.length===0||(Boolean(settings.external_token_id)&&
      !configuredBankTokens.some(t=>t.id===settings.external_token_id)));
  const running=ACTIVE.has(status.state);
  const pausing=status.state==="pausing";
  const canResume=pausing||status.state==="paused";
  const scopeMode=settings.scope_mode||"all";
  const selectedIndices=settings.chapter_indices||[];
  const scopedChapters=scopeMode==="all"?chapters
    :scopeMode==="first_n"?chapters.slice(0,settings.chapter_count??1)
    :chapters.filter(item=>selectedIndices.includes(item.index));
  const selectedCount=scopedChapters.reduce((sum,item)=>sum+item.count,0);
  // Even the all-chapters mode needs a loaded catalog; otherwise switching
  // courses can start a task before the new course's scope is known.
  const missingScope=chapterLoading||Boolean(chapterError)||chapters.length===0||
    scopedChapters.length===0;
  const invalidParameterLabels=(Object.keys(NUMBER_LIMITS) as NumberLimitKey[])
    .filter(key=>{
      const value=settings[key]??(key==="max_external_calls"?40:undefined);
      const {min,max}=NUMBER_LIMITS[key];
      return typeof value!=="number"||!Number.isInteger(value)||value<min||value>max;
    }).map(key=>NUMBER_LIMITS[key].label as string);
  const chapterCount=settings.chapter_count??1;
  if(!Number.isInteger(chapterCount)||chapterCount<1||chapterCount>200||
     (scopeMode==="first_n"&&chapters.length>0&&chapterCount>chapters.length))
    invalidParameterLabels.push("前 N 章数量");
  const invalidConfig=invalidParameterLabels.length>0;
  const currentTask=status.current?status.tasks.find(t=>t.knowledge_id===status.current?.knowledge_id):undefined;
  const chapterProgress=(status.selected_chapters||[]).map(chapter=>{
    const items=status.tasks.filter(item=>item.chapter_index===chapter.index);
    return {...chapter,processed:items.filter(t=>t.state==="done"||t.state==="skipped").length,
      done:items.filter(t=>t.state==="done").length,active:items.some(t=>t.state==="working")};
  });
  const remaining=Math.max(0,status.total-status.processed);
  const percent=status.total>0?Math.round(status.processed/status.total*100):0;
  // "processed" includes skipped items; only "done" means server-confirmed target.
  const confirmedPercent=status.total>0?Math.round(status.done/status.total*100):0;
  const failed=useMemo(()=>status.tasks.filter(item=>item.state==="skipped"),[status.tasks]);

  const update=(key:"target"|"max_rounds"|"stagnation_rounds"|"max_minutes"|"max_ai_calls"|"max_external_calls",value:number)=>{
    setSettings(previous=>({...previous,[key]:value}));
  };
  const start=async()=>{
    if(!desktop||busy||running||missingScope||missingExternalToken||invalidConfig)return;
    statusVersion.current+=1;
    setBusy(true);setError("");
    try{
      const options={...settings,...(["bank_ai","ai_first"].includes(settings.first_round_mode)?{api_key:aiKey.trim()}: {})};
      const value=await masteryAutoStart(courseKey,options);
      if(isCurrent()){
        statusVersion.current+=1;
        applyStatus(value);
        setAiKey("");
      }
    }catch(cause){
      if(isCurrent()){
        statusVersion.current+=1;
        setError(friendlyBridgeError(cause));
      }
    }finally{if(isCurrent())setBusy(false);}
  };
  const control=async(action:"pause"|"resume"|"stop")=>{
    if(!desktop||busy||!running)return;
    statusVersion.current+=1;
    setBusy(true);setError("");
    try{
      const value=await masteryAutoControl(courseKey,action);
      if(isCurrent()){
        statusVersion.current+=1;
        applyStatus(value);
      }
    }catch(cause){
      if(isCurrent()){
        statusVersion.current+=1;
        setError(friendlyBridgeError(cause));
      }
    }finally{if(isCurrent())setBusy(false);}
  };

  if(!desktop)return null;
  return <section className="sf-mastery-auto" aria-label="知到自动掌握度工作台">
    <header className="sf-mastery-auto-heading">
      <div>
        <span className="sf-mastery-auto-eyebrow">知到 AI · 章节掌握度</span>
        <h4>自动掌握度工作台</h4>
        <p>选择执行章节与答题策略，右侧实时查看知识点、轮次和后台状态。</p>
      </div>
      <strong className={"sf-mastery-auto-state is-"+status.state} aria-live="polite">
        {LABEL[status.state]??status.state}
      </strong>
    </header>

    <div className="sf-mastery-auto-layout">
      <div className="sf-mastery-auto-config" aria-label="任务配置">
        <section className="sf-mastery-auto-card" aria-label="执行范围">
          <div className="sf-mastery-auto-card-heading">
            <strong><Layers3 size={15}/> 01 · 执行范围</strong>
            <button type="button" className="secondary sf-mastery-auto-mini"
              disabled={running||busy||chapterLoading} onClick={()=>void reloadChapters()}>
              <RefreshCw size={12}/>刷新章节
            </button>
          </div>
          <div className="sf-mastery-auto-scope-options" role="group" aria-label="选择处理章节范围">
            {([
              ["all","全部章节"],["single","只做一章"],
              ["first_n","前 N 章"],["selected","自选章节"],
            ] as const).map(([mode,label])=><button type="button" key={mode}
              className={scopeMode===mode?"is-selected":""}
              aria-pressed={scopeMode===mode} disabled={running||busy}
              onClick={()=>setSettings(previous=>({...previous,scope_mode:mode}))}>
              {label}
            </button>)}
          </div>
          {scopeMode==="first_n"&&<label className="sf-mastery-auto-inline-field">从第一章开始，依次处理
            <input type="number" min={1} max={Math.max(1,chapters.length)}
              disabled={running||busy||chapterLoading} value={settings.chapter_count??1}
              onChange={event=>setSettings(previous=>({...previous,
                chapter_count:Number(event.target.value)}))}/>
            章
          </label>}
          {scopeMode==="single"&&<label className="sf-mastery-auto-field">
            指定一章
            <select disabled={running||busy||chapterLoading||!chapters.length}
              value={selectedIndices[0]??""}
              onChange={event=>setSettings(previous=>({...previous,
                chapter_indices:[Number(event.target.value)]}))}>
              {!chapters.length&&<option value="">暂无章节目录</option>}
              {chapters.map(ch=><option key={ch.index} value={ch.index}>
                第{ch.index}章 · {ch.name}（{ch.count}知识点）
              </option>)}
            </select>
          </label>}
          {scopeMode==="selected"&&<div className="sf-mastery-auto-chapter-picker" role="group"
              aria-label="自定义章节">
            {chapters.map(ch=><label key={ch.index}>
              <input type="checkbox" disabled={running||busy} checked={selectedIndices.includes(ch.index)}
                onChange={event=>setSettings(previous=>{
                  const original=previous.chapter_indices||[];
                  const next=event.target.checked
                    ?[...original,ch.index].sort((a,b)=>a-b)
                    :original.filter(index=>index!==ch.index);
                  return {...previous,chapter_indices:next};
                })}/>
              <span>第{ch.index}章 · {ch.name}</span>
              <small>{ch.count} 点</small>
            </label>)}
          </div>}
          <p className="sf-mastery-auto-scope-summary">
            {chapterLoading?"正在只读加载章节…":chapterError?"章节目录读取失败":
              chapters.length? `本次选择 ${scopedChapters.length}/${chapters.length} 章 · ${selectedCount} 个知识点`
                :"尚未加载到章节目录"}
          </p>
          {chapterError&&<p className="sf-mastery-auto-error" role="alert">{chapterError}</p>}
          {missingScope&&<p className="sf-mastery-auto-error">请先选择有效章节，再开始任务。</p>}
        </section>

        <section className="sf-mastery-auto-card" aria-label="答题方案">
          <div className="sf-mastery-auto-card-heading">
            <strong><BookOpen size={15}/> 02 · 答题策略</strong>
          </div>
          <label className="sf-mastery-auto-field">首轮处理方式
            <select disabled={running||busy} value={settings.first_round_mode}
              onChange={event=>setSettings(previous=>({...previous,
                first_round_mode:event.target.value as MasteryAutoSettings["first_round_mode"]}))}>
              <option value="bank_only">本地已验证题库优先 · 未知题有界尝试</option>
              <option value="bank_ai">已验证题库 → 外部题库 → AI</option>
              <option value="ai_first">首轮 AI 优先 · 后续使用已验证答案</option>
              <option value="arbitrary_first">首轮随意作答 · 根据官方判分继续</option>
            </select>
          </label>
          {["bank_ai","ai_first"].includes(settings.first_round_mode)&&<div className="sf-mastery-auto-two-fields">
            <label className="sf-mastery-auto-field">DeepSeek API Key（仅本次）
              <input type="password" autoComplete="off" disabled={running||busy}
                value={aiKey} placeholder="输入 API Key"
                onChange={event=>setAiKey(event.target.value)}/>
            </label>
            <label className="sf-mastery-auto-field">AI 调用上限
              <input type="number" min={1} max={100} disabled={running||busy}
                value={settings.max_ai_calls}
                onChange={event=>update("max_ai_calls",Number(event.target.value))}/>
            </label>
          </div>}
          <div className="sf-mastery-auto-separator"/>
          <label className="sf-mastery-auto-switch">
            <input type="checkbox" disabled={running||busy}
              checked={Boolean(settings.use_external_bank)}
              onChange={event=>setSettings(previous=>({...previous,
                use_external_bank:event.target.checked}))}/>
            <span><strong>自动调用共享题库</strong><small>本地已验证答案未命中时，按题库 Token 策略查询</small></span>
          </label>
          {settings.use_external_bank&&<>
            <div className="sf-mastery-auto-two-fields">
              <label className="sf-mastery-auto-field">题库
                <select disabled={running||busy} value={settings.external_provider_id||""}
                  onChange={event=>{
                    const provider=event.target.value;
                    setSettings(previous=>({...previous,external_provider_id:provider,
                      external_token_id:""}));
                  }}>
                  {bankState.providers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="sf-mastery-auto-field">Token 使用方式
                <select value={settings.external_token_id||""}
                  disabled={running||busy||!configuredBankTokens.length}
                  onChange={event=>setSettings(previous=>({...previous,
                    external_token_id:event.target.value}))}>
                  <option value="">{configuredBankTokens.length?"按题库策略自动选择":"暂无 Token"}</option>
                  {configuredBankTokens.map(item=><option key={item.id} value={item.id}>
                    {item.label}{item.active?"（默认）":""}
                  </option>)}
                </select>
              </label>
            </div>
            <div className="sf-mastery-auto-two-fields">
              <label className="sf-mastery-auto-field">外部查询次数上限
                <input type="number" min={1} max={200} disabled={running||busy}
                  value={settings.max_external_calls??40}
                  onChange={event=>update("max_external_calls",Number(event.target.value))}/>
              </label>
              <button className="secondary sf-mastery-auto-refresh-bank" type="button"
                disabled={busy||running} onClick={()=>void reloadBanks()}>
                <RefreshCw size={12}/>刷新 Token
              </button>
            </div>
            {missingExternalToken&&<p className="sf-mastery-auto-error">请先到「设置 → 题库与搜题」保存并选择 Token。</p>}
            {bankError&&<p className="sf-mastery-auto-error" role="alert">{bankError}</p>}
            <p className="sf-mastery-auto-note">外部查询会发送题干、选项和所选 Token，可能消耗额度；结果以知到官方判分为准。</p>
          </>}
        </section>

        <section className="sf-mastery-auto-card" aria-label="运行限制">
          <div className="sf-mastery-auto-card-heading"><strong>03 · 运行限制</strong></div>
          <div className="sf-mastery-auto-two-fields">
            <label className="sf-mastery-auto-field">目标分数
              <input type="number" min={1} max={100} disabled={running||busy}
                value={settings.target} onChange={event=>update("target",Number(event.target.value))}/>
            </label>
            <label className="sf-mastery-auto-field">每知识点最多轮次
              <input type="number" min={1} max={30} disabled={running||busy}
                value={settings.max_rounds} onChange={event=>update("max_rounds",Number(event.target.value))}/>
            </label>
            <label className="sf-mastery-auto-field">连续不涨分停止
              <input type="number" min={1} max={10} disabled={running||busy}
                value={settings.stagnation_rounds}
                onChange={event=>update("stagnation_rounds",Number(event.target.value))}/>
            </label>
            <label className="sf-mastery-auto-field">最长运行（分钟）
              <input type="number" min={1} max={720} disabled={running||busy}
                value={settings.max_minutes} onChange={event=>update("max_minutes",Number(event.target.value))}/>
            </label>
          </div>
          {invalidConfig&&<p className="sf-mastery-auto-error" role="alert">
            参数不符合允许范围：{invalidParameterLabels.join("、")}。请填写范围内的整数后再启动。
          </p>}
        </section>
      </div>

      <aside className="sf-mastery-auto-monitor" aria-label="执行进度与状态">
        <div className="sf-mastery-auto-actions">
          <button type="button" className="sf-mastery-auto-start"
            disabled={busy||running||missingExternalToken||missingScope||invalidConfig||
              (["bank_ai","ai_first"].includes(settings.first_round_mode)&&!aiKey.trim())}
            onClick={()=>void start()}>
            <Play size={14}/>{status.total>0?"重新执行选定范围":"开始执行"}
          </button>
          <button type="button" className="secondary"
            disabled={busy||!running||status.state==="stopping"}
            onClick={()=>void control(canResume?"resume":"pause")}>
            {canResume?<><RotateCcw size={14}/>{pausing?"取消待暂停":"继续"}</>
              :<><Pause size={14}/>完成当前项后暂停</>}
          </button>
          <button type="button" className="secondary"
            disabled={busy||!running||status.state==="stopping"}
            onClick={()=>void control("stop")}><Square size={14}/>停止</button>
          <button type="button" className="secondary sf-mastery-auto-mini"
            disabled={busy} onClick={()=>void refresh()}><RefreshCw size={13}/>刷新</button>
        </div>
        {error&&<p className="sf-mastery-auto-error" role="alert">{error}</p>}
        <div className="sf-mastery-auto-live" aria-live="polite">
          <span className="sf-mastery-auto-eyebrow">当前执行</span>
          <strong>{status.current?.name||(
            status.state==="paused"?"已暂停，下一知识点尚未开始":
            status.state==="pausing"?"正在等待当前知识点结束":
            status.state==="completed"?"本次选择的章节已处理完":
            status.state==="idle"?"未开始，先设置左侧参数":"后台正在准备或等待"
          )}</strong>
          {status.current&&<small>{status.current.theme} · 第 {currentTask?.rounds||1} 轮</small>}
          <p>{currentTask?.reason||status.message||"启动后显示当前知识点与实际处理阶段。"}</p>
          {pausing&&<p className="sf-mastery-auto-pause-notice">
            <Pause size={12}/> 当前知识点完成后暂停，不会中断保存与判分步骤
          </p>}
        </div>
        <section className="sf-mastery-auto-overview" aria-label="整体处理进度">
          <div className="sf-mastery-auto-progress-top">
            <strong>任务已处理（含未达标项）</strong>
            <b>{status.processed}/{status.total} <small>知识点</small></b>
          </div>
          <div className="sf-mastery-auto-progress" role="progressbar"
            aria-label="已处理知识点进度" aria-valuemin={0}
            aria-valuemax={100} aria-valuenow={percent}>
            <span style={{width:percent+"%"}}/>
          </div>
          <div className="sf-mastery-auto-progress-top sf-mastery-auto-confirmed-top">
            <strong>服务器确认达标</strong>
            <b>{status.done}/{status.total} <small>知识点</small></b>
          </div>
          <div className="sf-mastery-auto-progress is-verified" role="progressbar"
            aria-label="服务器确认达标知识点进度" aria-valuemin={0}
            aria-valuemax={100} aria-valuenow={confirmedPercent}>
            <span style={{width:confirmedPercent+"%"}}/>
          </div>
          <div className="sf-mastery-auto-metrics">
            <div><strong>{status.done}</strong><small>已达标</small></div>
            <div><strong>{status.skipped}</strong><small>需处理</small></div>
            <div><strong>{remaining}</strong><small>剩余</small></div>
            <div><strong>{status.selected_chapters?.length??0}/{status.chapter_total??chapters.length}</strong><small>本次章节</small></div>
          </div>
          <p className="sf-mastery-auto-note">{status.message||"尚未启动自动任务"}</p>
          {status.state==="completed"&&status.skipped>0&&
            <p className="sf-mastery-auto-evidence-note" role="status">
              本次扫描已结束，但仍有 {status.skipped} 个知识点未确认达标。
              请展开知识点明细查看原因，处理完毕不等于全部达标。
            </p>}
        </section>
        {chapterProgress.length>0&&<section className="sf-mastery-auto-chapter-progress">
          <div className="sf-mastery-auto-card-heading">
            <strong>章节执行情况</strong><small>{chapterProgress.length} 章</small>
          </div>
          <div className="sf-mastery-auto-chapter-list">
            {chapterProgress.map(ch=><div key={ch.index} className={ch.active?"is-active":""}>
              <div><span>第{ch.index}章 · {ch.name}</span>
                <small>已处理 {ch.processed}/{ch.knowledge_count}</small>
              </div>
              <div className="sf-mastery-auto-progress" role="progressbar"
                aria-label={`第${ch.index}章任务已处理`} aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={ch.knowledge_count?Math.round(ch.processed/ch.knowledge_count*100):0}>
                <span style={{width:(ch.knowledge_count?
                  ch.processed/ch.knowledge_count*100:0)+"%"}}/>
              </div>
              <p className="sf-mastery-auto-chapter-confirmed">服务器确认达标 {ch.done}/{ch.knowledge_count}</p>
              <div className="sf-mastery-auto-progress is-verified" role="progressbar"
                aria-label={`第${ch.index}章服务器确认达标`} aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={ch.knowledge_count?Math.round(ch.done/ch.knowledge_count*100):0}>
                <span style={{width:(ch.knowledge_count?
                  ch.done/ch.knowledge_count*100:0)+"%"}}/>
              </div>
            </div>)}
          </div>
        </section>}
        {status.tasks.length>0&&<section className="sf-mastery-auto-task-list">
          <button className="secondary" type="button" aria-expanded={detailsOpen}
            onClick={()=>setDetailsOpen(current=>!current)}>
            <ChevronDown size={14}/> {detailsOpen?"收起":"展开"}知识点明细（{status.processed}/{status.total}）
          </button>
          {detailsOpen&&<ul>{status.tasks.map(item=><li key={item.knowledge_id}>
            <span>{item.theme} / {item.name}</span>
            <span>{item.mastery===null?"—":item.mastery+"分"} · {item.rounds}轮 ·
              {item.state==="done"?<><CheckCircle2 size={12}/>达标</>:
                item.state==="working"?"进行中":item.state==="pending"?"待处理":"需处理"}</span>
            {item.reason&&<small>{item.reason}</small>}
          </li>)}</ul>}
        </section>}
        <details className="sf-mastery-auto-diagnostics">
          <summary>题库和答题统计</summary>
          <div>
            <span>已验证本地答案 <b>{status.bank_hits??0}</b></span>
            <span>外部题库命中 <b>{status.external_hits??0}</b></span>
            <span>外部请求 <b>{status.external_calls??0}</b></span>
            <span>外部错误 <b>{status.external_errors??0}</b></span>
            <span>AI 命中 <b>{status.ai_used??0}</b></span>
            <span>AI 请求 <b>{status.ai_calls??0}</b></span>
            <span>本地试答 <b>{status.trials??0}</b></span>
          </div>
        </details>
        {(status.blocked?.length??0)>0&&<p className="sf-mastery-auto-error" role="status">
          {status.blocked?.length} 个旧试卷待核验；未确认前不会重复交卷。
        </p>}
        {status.submitting&&<p className="sf-mastery-auto-error" role="status">
          当前交卷状态待核验，系统不会重复发送不确定的提交。
        </p>}
        {failed.length>0&&<p className="sf-mastery-auto-note">
          {failed.length} 个知识点未自动达标，原因可在明细中查看。
        </p>}
      </aside>
    </div>
    <p className="sf-mastery-auto-footnote">
      暂停会在当前知识点处理结束后生效；停止会在下一个安全检查点生效。
      已验证答案优先，第三方参考答案须经过官方判分才会收录为正确答案。
    </p>
  </section>;
}
