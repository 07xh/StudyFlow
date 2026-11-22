import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {sameStatusSnapshot} from "../statusSnapshot";
import {Pause,Play,RotateCcw,Square,CheckCircle2} from "lucide-react";
import {
  masteryAutoControl,masteryAutoStart,masteryAutoStatus,friendlyBridgeError,
  questionBankList,type QuestionBankState,
  type MasteryAutoSettings,type MasteryAutoStatus,
} from "../bridge";
import "./MasteryAutoPanel.css";

const DEFAULT:MasteryAutoSettings={
  target:100,max_rounds:12,stagnation_rounds:3,max_minutes:180,
  first_round_mode:"bank_only",max_ai_calls:30,
  use_external_bank:false,external_provider_id:"yanxi",
  external_token_id:"",max_external_calls:40,
};
const IDLE:MasteryAutoStatus={
  state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[],
};
const ACTIVE=new Set(["starting","running","paused","stopping"]);
// Timestamps are diagnostic metadata, not a change to displayed task progress.
const NON_VISUAL_FIELDS=new Set(["updated_at"]);
const LABEL:Record<string,string>={
  idle:"未开始",starting:"准备中",running:"后台运行中",paused:"已暂停",
  stopping:"正在停止",stopped:"已停止",completed:"本次扫描完成",
  error:"运行出错",interrupted:"上次任务中断",needs_attention:"需核验提交状态",
};

export function MasteryAutoPanel({courseKey,desktop}:{
  courseKey:string;desktop:boolean;
}){
  const [status,setStatus]=useState<MasteryAutoStatus>(IDLE);
  const latestStatus=useRef<MasteryAutoStatus>(IDLE);
  const applyStatus=useCallback((value:MasteryAutoStatus)=>{
    // Do not call React's state setter at all if the backend only changes
    // its bookkeeping timestamp. This also protects a long knowledge list.
    if(sameStatusSnapshot(latestStatus.current,value,NON_VISUAL_FIELDS))return;
    latestStatus.current=value;
    setStatus(value);
  },[]);
  const [settings,setSettings]=useState<MasteryAutoSettings>(DEFAULT);
  const [busy,setBusy]=useState(false);
  const [aiKey,setAiKey]=useState("");
  const [bankState,setBankState]=useState<QuestionBankState>({providers:[],tokens:[]});
  const [bankError,setBankError]=useState("");
  const [error,setError]=useState("");
  const statusInFlight=useRef(false);
  const refresh=useCallback(async()=>{
    if(!desktop||statusInFlight.current)return;
    statusInFlight.current=true;
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
      applyStatus(value);
    }catch(cause){
      const message=friendlyBridgeError(cause);
      setError(previous=>previous===message?previous:message);
    }finally{
      if(timeoutId!==undefined)window.clearTimeout(timeoutId);
      statusInFlight.current=false;
    }
  },[courseKey,desktop,applyStatus]);

  useEffect(()=>{
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
        const token=valid?previous.external_token_id
          :state.tokens.find(t=>t.provider_id===provider&&t.active)?.id
          ||state.tokens.find(t=>t.provider_id===provider)?.id||"";
        return {...previous,external_provider_id:provider,external_token_id:token};
      });
    }catch(cause){setBankError(friendlyBridgeError(cause));}
  },[desktop]);
  useEffect(()=>{void reloadBanks();},[reloadBanks]);

  const configuredBankTokens=bankState.tokens.filter(t=>t.provider_id===settings.external_provider_id);
  const missingExternalToken=Boolean(settings.use_external_bank)&&!configuredBankTokens
    .some(t=>t.id===settings.external_token_id);
  const running=ACTIVE.has(status.state);
  const work=status.state==="running"||status.state==="starting";
  const remaining=Math.max(0,status.total-status.processed);
  const percent=status.total>0?Math.round(status.processed/status.total*100):0;
  const failed=useMemo(()=>status.tasks.filter(item=>item.state==="skipped"),[status.tasks]);

  const update=(key:"target"|"max_rounds"|"stagnation_rounds"|"max_minutes"|"max_ai_calls",value:number)=>{
    setSettings(previous=>({...previous,[key]:value}));
  };
  const start=async()=>{
    if(!desktop||busy||running)return;
    setBusy(true);setError("");
    try{
      const options={...settings,...(["bank_ai","ai_first"].includes(settings.first_round_mode)?{api_key:aiKey.trim()}: {})};
      applyStatus(await masteryAutoStart(courseKey,options));
      setAiKey("");
    }catch(cause){
      setError(friendlyBridgeError(cause));
    }finally{setBusy(false);}
  };
  const control=async(action:"pause"|"resume"|"stop")=>{
    if(!desktop||busy||!running)return;
    setBusy(true);setError("");
    try{
      applyStatus(await masteryAutoControl(courseKey,action));
    }catch(cause){
      setError(friendlyBridgeError(cause));
    }finally{setBusy(false);}
  };

  if(!desktop)return null;
  return <section className="sf-mastery-auto" aria-label="自动完成全课程掌握度">
    <div className="sf-mastery-auto-heading">
      <div>
        <h4>全课程自动掌握度</h4>
        <p>一键扫描全部章节知识点，未达标自动开新卷、保存作答、提交并核对官方掌握度，达标后继续下一个。纯 HTTP、无独立窗口，AI 是否参与由首轮策略决定。</p>
      </div>
      <strong className="sf-mastery-auto-state" aria-live="polite">{LABEL[status.state]??status.state}</strong>
    </div>
    <div className="sf-mastery-auto-preference">
      <label>首轮答题方式
        <select disabled={running||busy} value={settings.first_round_mode}
          onChange={event=>setSettings(previous=>({...previous,
            first_round_mode:event.target.value as MasteryAutoSettings["first_round_mode"]
          }))}>
          <option value="bank_only">题库与本地有界试答（不调用 AI）</option>
          <option value="bank_ai">已验证题库优先，未命中询问 AI（推荐）</option>
          <option value="ai_first">首轮 AI 优先，后续优先用已验证题库</option>
          <option value="arbitrary_first">首轮随意作答并提交，后续用官方结果与题库</option>
        </select>
      </label>
      {["bank_ai","ai_first"].includes(settings.first_round_mode)&&<>
        <label>DeepSeek API Key（仅本次执行）
          <input type="password" autoComplete="off" value={aiKey}
            disabled={running||busy} placeholder="输入 DeepSeek API Key"
            onChange={event=>setAiKey(event.target.value)}/>
        </label>
        <label>最多 AI 请求次数
          <input type="number" min={1} max={100} disabled={running||busy}
            value={settings.max_ai_calls}
            onChange={event=>update("max_ai_calls",Number(event.target.value))}/>
        </label>
      </>}
    </div>
    <div className="sf-mastery-auto-preference">
      <label className="sf-mastery-auto-external-switch">
        <input type="checkbox" checked={Boolean(settings.use_external_bank)}
          disabled={running||busy}
          onChange={event=>setSettings(previous=>({...previous,
            use_external_bank:event.target.checked}))}/>
        使用共享题库自动查询未命中题目
      </label>
      {settings.use_external_bank&&<>
        <label>题库来源
          <select value={settings.external_provider_id||""} disabled={running||busy}
            onChange={event=>{
              const id=event.target.value;
              const selected=bankState.tokens.find(t=>t.provider_id===id&&t.active)
                ||bankState.tokens.find(t=>t.provider_id===id);
              setSettings(previous=>({...previous,external_provider_id:id,
                external_token_id:selected?.id||""}));
            }}>
            {bankState.providers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>用于自动查询的 Token
          <select value={settings.external_token_id||""} disabled={running||busy||!configuredBankTokens.length}
            onChange={event=>setSettings(previous=>({...previous,
              external_token_id:event.target.value}))}>
            {!configuredBankTokens.length&&<option value="">尚未配置 Token</option>}
            {configuredBankTokens.map(item=><option key={item.id} value={item.id}>
              {item.label}{item.active?"（默认）":""}
            </option>)}
          </select>
        </label>
        <label>本次最多外部题库请求
          <input type="number" min={1} max={200} disabled={running||busy}
            value={settings.max_external_calls??40}
            onChange={event=>setSettings(previous=>({...previous,
              max_external_calls:Number(event.target.value)}))}/>
        </label>
        <button className="secondary" type="button" disabled={busy||running}
          onClick={()=>void reloadBanks()}>刷新题库列表</button>
      </>}
    </div>
    {settings.use_external_bank&&<p className="sf-mastery-auto-caption">
      已验证本地答案优先；外部查询未命中或不能明确匹配选项时回退到原策略。
      每道题最多查询一次，按本次次数上限停止外部查询，不会自动切换 Token。
      查询会向所选题库发送题干、选项和 Token，可能扣除额度，结果仍以平台判分为准。
      {missingExternalToken?" 请先在全局设置 → 题库与搜题中配置 Token。":""}
    </p>}
    {bankError&&settings.use_external_bank&&<p className="sf-mastery-auto-error" role="alert">{bankError}</p>}
    {["bank_ai","ai_first"].includes(settings.first_round_mode)&&<p className="sf-mastery-auto-caption">
      启用后仅把题干与选项发送至 DeepSeek；不会上传知到 Cookie、账户信息或题目 ID。
      AI 答案未经验证，必须以服务器交卷结果确认。
    </p>}
    <div className="sf-mastery-auto-settings">
      <label>目标分数
        <input type="number" min={1} max={100} disabled={running||busy}
          value={settings.target} onChange={event=>update("target",Number(event.target.value))}/>
      </label>
      <label>每知识点最多轮次
        <input type="number" min={1} max={30} disabled={running||busy}
          value={settings.max_rounds} onChange={event=>update("max_rounds",Number(event.target.value))}/>
      </label>
      <label>连续不涨分停止
        <input type="number" min={1} max={10} disabled={running||busy}
          value={settings.stagnation_rounds} onChange={event=>update("stagnation_rounds",Number(event.target.value))}/>
      </label>
      <label>最多运行（分钟）
        <input type="number" min={1} max={720} disabled={running||busy}
          value={settings.max_minutes} onChange={event=>update("max_minutes",Number(event.target.value))}/>
      </label>
    </div>
    <div className="sf-mastery-auto-actions">
      <button type="button" disabled={busy||running||missingExternalToken||(["bank_ai","ai_first"].includes(settings.first_round_mode)&&!aiKey.trim())} onClick={()=>void start()}>
        <Play size={14}/>{status.total>0?"重新扫描全部章节":"开始全部章节"}
      </button>
      <button type="button" className="secondary" disabled={busy||!running||status.state==="stopping"}
        onClick={()=>void control(work?"pause":"resume")}>
        {work?<><Pause size={14}/>暂停</>:<><RotateCcw size={14}/>继续</>}
      </button>
      <button type="button" className="secondary" disabled={busy||!running||status.state==="stopping"}
        onClick={()=>void control("stop")}>
        <Square size={14}/>停止
      </button>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void refresh()}>
        刷新状态
      </button>
    </div>
    {error&&<p className="sf-mastery-auto-error" role="alert">{error}</p>}
    <div className="sf-mastery-auto-metrics">
      <span>总知识点 <b>{status.total}</b></span>
      <span>已达标 <b>{status.done}</b></span>
      <span>需处理 <b>{status.skipped}</b></span>
      <span>剩余 <b>{remaining}</b></span>
      <span>已验证本地题库命中 <b>{status.bank_hits??0}</b></span>
      <span>外部题库参考 <b>{status.external_hits??0}</b> / {status.external_calls??0} 次</span>
      {(status.external_errors??0)>0&&<span>外部查询错误 <b>{status.external_errors}</b> 次</span>
      <span>AI 使用 <b>{status.ai_used??0}</b> / {status.ai_calls??0} 次</span>
      <span>试答 <b>{status.trials??0}</b></span>
      {(status.ai_errors??0)>0&&<span>AI 失败已回退 <b>{status.ai_errors}</b> 次</span>}
    </div>
    <div className="sf-mastery-auto-progress" role="progressbar"
      aria-label="全课程知识点处理进度" aria-valuemin={0}
      aria-valuemax={100} aria-valuenow={percent}>
      <span style={{width:percent+"%"}}/>
    </div>
    <p className="sf-mastery-auto-caption">{status.message||"启动后自动执行，不需要逐轮点击“再练一轮”。"}</p>
    {status.current&&<p className="sf-mastery-auto-current">
      当前：{status.current.theme} / {status.current.name}
    </p>}
    {(status.blocked?.length??0)>0&&<p className="sf-mastery-auto-caption" role="status">
      {status.blocked?.length} 个知识点存在待核验旧试卷。再次开始只会先核验旧试卷状态；未确认前不会新建或提交其他练习。
    </p>}
    {status.submitting&&<p className="sf-mastery-auto-caption" role="status">
      有交卷操作需要核验：本程序不会对状态不确定的试卷自动重复提交。
    </p>}
    {status.tasks.length>0&&<details className="sf-mastery-auto-detail">
      <summary>查看全部章节进度（{status.processed}/{status.total}）</summary>
      <ul>{status.tasks.map(item=><li key={item.knowledge_id}>
        <span>{item.theme} / {item.name}</span>
        <span>{item.mastery===null?"—":item.mastery+"分"} · {item.rounds}轮 ·
          {item.state==="done"?<><CheckCircle2 size={12}/>达标</>:
            item.state==="working"?"进行中":item.state==="pending"?"待处理":"需处理"}
        </span>
        {item.reason&&<small>{item.reason}</small>}
      </li>)}</ul>
    </details>}
    {failed.length>0&&<p className="sf-mastery-auto-caption">
      {failed.length} 个知识点未自动达标。未验证答案的填空题、未知交卷状态和无进步的练习，会保留供手动处理。
    </p>}
    <p className="sf-mastery-auto-footnote">
      目标 100 分不代表保证达到 100 分。本地已验证题库只收录平台公布或明确判对的答案；
      外部题库答案未经核验，只有官方判分确认后才能加入本地库。
      未知选择题有界试答，未知填空题仅一次占位尝试。最终掌握度以知到服务器结果为准。
    </p>
  </section>;
}
