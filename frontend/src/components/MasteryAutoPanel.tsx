import {useCallback,useEffect,useMemo,useState} from "react";
import {Pause,Play,RotateCcw,Square,CheckCircle2} from "lucide-react";
import {
  masteryAutoControl,masteryAutoStart,masteryAutoStatus,friendlyBridgeError,
  type MasteryAutoSettings,type MasteryAutoStatus,
} from "../bridge";
import "./MasteryAutoPanel.css";

const DEFAULT:MasteryAutoSettings={
  target:100,max_rounds:12,stagnation_rounds:3,max_minutes:180,
  first_round_mode:"bank_only",max_ai_calls:30,
};
const IDLE:MasteryAutoStatus={
  state:"idle",total:0,processed:0,done:0,skipped:0,tasks:[],
};
const ACTIVE=new Set(["starting","running","paused","stopping"]);
const LABEL:Record<string,string>={
  idle:"未开始",starting:"准备中",running:"后台运行中",paused:"已暂停",
  stopping:"正在停止",stopped:"已停止",completed:"本次扫描完成",
  error:"运行出错",interrupted:"上次任务中断",
};

export function MasteryAutoPanel({courseKey,desktop}:{
  courseKey:string;desktop:boolean;
}){
  const [status,setStatus]=useState<MasteryAutoStatus>(IDLE);
  const [settings,setSettings]=useState<MasteryAutoSettings>(DEFAULT);
  const [busy,setBusy]=useState(false);
  const [aiKey,setAiKey]=useState("");
  const [error,setError]=useState("");
  const refresh=useCallback(async()=>{
    if(!desktop)return;
    try{
      setStatus(await masteryAutoStatus(courseKey));
    }catch(cause){
      setError(friendlyBridgeError(cause));
    }
  },[courseKey,desktop]);

  useEffect(()=>{
    if(!desktop)return;
    let alive=true;
    void masteryAutoStatus(courseKey)
      .then(value=>{if(alive)setStatus(value);})
      .catch(cause=>{if(alive)setError(friendlyBridgeError(cause));});
    // Polling reads a local snapshot. It never triggers a new paper or submit.
    const timer=window.setInterval(()=>{
      void masteryAutoStatus(courseKey).then(value=>{
        if(alive)setStatus(value);
      }).catch(()=>{});
    },2500);
    return ()=>{alive=false;window.clearInterval(timer);};
  },[courseKey,desktop]);

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
      const options={...settings,...(settings.first_round_mode!=="bank_only"?{api_key:aiKey.trim()}: {})};
      setStatus(await masteryAutoStart(courseKey,options));
      setAiKey("");
    }catch(cause){
      setError(friendlyBridgeError(cause));
    }finally{setBusy(false);}
  };
  const control=async(action:"pause"|"resume"|"stop")=>{
    if(!desktop||busy||!running)return;
    setBusy(true);setError("");
    try{
      setStatus(await masteryAutoControl(courseKey,action));
    }catch(cause){
      setError(friendlyBridgeError(cause));
    }finally{setBusy(false);}
  };

  if(!desktop)return null;
  return <section className="sf-mastery-auto" aria-label="自动完成全课程掌握度">
    <div className="sf-mastery-auto-heading">
      <div>
        <h4>全课程自动掌握度</h4>
        <p>一键扫描全部章节知识点，未达标自动开新卷、保存作答、提交并核对官方掌握度，达标后继续下一个。纯 HTTP，无浏览器、无 AI。</p>
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
        </select>
      </label>
      {settings.first_round_mode!=="bank_only"&&<>
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
    {settings.first_round_mode!=="bank_only"&&<p className="sf-mastery-auto-caption">
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
      <button type="button" disabled={busy||running||(settings.first_round_mode!=="bank_only"&&!aiKey.trim())} onClick={()=>void start()}>
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
      <span>题库命中 <b>{status.bank_hits??0}</b></span>
      <span>AI 使用 <b>{status.ai_used??0}</b> / {status.ai_calls??0} 次</span>
      <span>试答 <b>{status.trials??0}</b></span>
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
      目标 100 分不代表保证达到 100 分。题库只把平台公布或明确判对的答案视为正确；
      未知选择题有界试答，未知填空题仅一次占位尝试。最终掌握度以知到服务器结果为准。
    </p>
  </section>;
}
