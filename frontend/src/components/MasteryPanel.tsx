import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {BookOpen,CheckCircle2,CircleHelp,RefreshCw,Play,XCircle} from "lucide-react";
import {
  masteryActiveRound,masteryCatalog,masteryDiscardRound,masterySaveAnswer,
  masteryStartRound,masterySubmitRound,
  masteryAutoStart,masteryAutoStatus,masteryAutoPause,masteryAutoResume,masteryAutoStop,
  friendlyBridgeError,
  type MasteryCatalog,type MasteryKnowledge,type MasteryQuestion,
  type MasteryRound,type MasterySubmitResult,type MasteryAutoStatus,
} from "../bridge";
import "./MasteryPanel.css";

type Draft = Record<string,string|number|Array<string|number>>;

const BAND_LABEL:{[key:string]:string}={low:"需要加强",mid:"基本掌握",high:"掌握良好"};

function bandClass(value:number|null|undefined):string{
  if(value===null||value===undefined)return "unknown";
  if(value<60)return "low";
  if(value<80)return "mid";
  return "high";
}

function typeLabel(type:number):string{
  switch(type){
    case 1:return "单选";
    case 2:return "多选";
    case 3:return "填空";
    case 14:return "判断";
    default:return "题目";
  }
}

/**
 * 「AI 掌握度」栏目。
 *
 * 掌握度习题是知识点练习（官方内部叫 AI 课程作业），不是考试：没有倒计时、
 * 没有监考，做题 → 保存 → 提交 → 看本轮判分与掌握度变化。
 * 每一轮都是服务器新建的卷，所以"再练一轮"就是重新建卷，不会覆盖历史。
 */
export function MasteryPanel({courseKey,courseTitle,desktop}:{
  courseKey:string;courseTitle:string;desktop:boolean;
}){
  const [catalog,setCatalog]=useState<MasteryCatalog|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<MasteryKnowledge|null>(null);
  const [round,setRound]=useState<MasteryRound|null>(null);
  const [lastQuestions,setLastQuestions]=useState<MasteryQuestion[]>([]);
  const [draft,setDraft]=useState<Draft>({});
  const [saved,setSaved]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState("");
  const [result,setResult]=useState<MasterySubmitResult|null>(null);
  const [notice,setNotice]=useState("");
  const [submissionCheck,setSubmissionCheck]=useState(false);
  const loadToken=useRef(0);
  const [auto,setAuto]=useState<MasteryAutoStatus|null>(null);
  const [autoBusy,setAutoBusy]=useState(false);
  const [autoError,setAutoError]=useState("");
  const [autoTarget,setAutoTarget]=useState(90);
  const [autoRounds,setAutoRounds]=useState(3);
  const [autoNext,setAutoNext]=useState(true);
  const [autoKnowledge,setAutoKnowledge]=useState("");
  const [autoAi,setAutoAi]=useState(false);
  const [autoKey,setAutoKey]=useState("");

  useEffect(()=>{
    if(!desktop)return;
    let cancelled=false;
    const sync=async()=>{
      try{
        const value=await masteryAutoStatus();
        if(!cancelled)setAuto(value);
      }catch{
        // Existing read-only mastery views remain usable even if auto task is unavailable.
      }
    };
    void sync();
    const timer=setInterval(()=>{void sync();},2500);
    // Node regression tests do not keep a process alive solely for UI polling.
    (timer as unknown as {unref?:()=>void}).unref?.();
    return ()=>{cancelled=true;clearInterval(timer);};
  },[desktop]);

  const startAuto=useCallback(async()=>{
    setAutoBusy(true);setAutoError("");
    try{
      const value=await masteryAutoStart(courseKey,{
        target:autoTarget,max_rounds:autoRounds,max_minutes:30,max_ai_calls:30,
        auto_next:autoNext,use_ai:autoAi,
        ...(autoKnowledge?{knowledge_id:autoKnowledge}:{}),
        ...(autoAi?{api_key:autoKey.trim()}:{}),
      });
      setAuto(value);
      setAutoKey(""); // The API Key must never persist in frontend state after dispatch.
    }catch(cause){
      setAutoError(friendlyBridgeError(cause));
    }finally{
      setAutoBusy(false);
    }
  },[courseKey,autoTarget,autoRounds,autoNext,autoAi,autoKey,autoKnowledge]);

  const controlAuto=useCallback(async(action:"pause"|"resume"|"stop")=>{
    setAutoBusy(true);setAutoError("");
    try{
      const value=action==="pause"?await masteryAutoPause()
        :action==="resume"?await masteryAutoResume():await masteryAutoStop();
      setAuto(value);
    }catch(cause){
      setAutoError(friendlyBridgeError(cause));
    }finally{
      setAutoBusy(false);
    }
  },[]);

  const loadCatalog=useCallback(async()=>{
    if(!desktop){setError("掌握度需要在桌面版中运行。");return;}
    const token=++loadToken.current;
    setLoading(true);setError("");setNotice("");
    try{
      const data=await masteryCatalog(courseKey,true);
      if(token!==loadToken.current)return;
      setCatalog(data);
    }catch(cause){
      if(token!==loadToken.current)return;
      setError(friendlyBridgeError(cause));
    }finally{
      if(token===loadToken.current)setLoading(false);
    }
  },[courseKey,desktop]);

  useEffect(()=>{void loadCatalog();},[loadCatalog]);

  const openKnowledge=useCallback(async(item:MasteryKnowledge)=>{
    setSelected(item);setRound(null);setResult(null);setDraft({});setSaved({});setNotice("");setSubmissionCheck(false);
    setBusy("open");
    try{
      const active=await masteryActiveRound(courseKey,item.knowledge_id);
      if(active&&active.questions.length){
        setRound({
          course_key:courseKey,knowledge_id:item.knowledge_id,
          exam_test_id:active.exam_test_id,exam_paper_id:active.exam_paper_id,
          question_num:active.total,questions:active.questions,
          high_mastery:active.high_mastery,mastery:null,mastery_change:null,
          threshold:catalog?.threshold??90,opened_at:active.opened_at,
        });
        // 服务端已经收下这些答案，回填时直接标成"已保存"，避免重复写。
        setDraft(active.draft||{});
        setSaved(Object.fromEntries(Object.keys(active.draft||{}).map(key=>[key,true])));
        const checking=Boolean(active.submission_state&&active.submission_state!=="draft");
        setSubmissionCheck(checking);
        setNotice(checking
          ?"这一轮的提交状态尚待核验；再次点击只会读取服务器状态，不会重复提交。"
          :`恢复了一轮未提交的练习（${active.answered}/${active.total} 已保存）。`);
      }else{
        const started=await masteryStartRound(courseKey,item.knowledge_id);
        setRound(started);
      }
    }catch(cause){
      setNotice(friendlyBridgeError(cause));
    }finally{
      setBusy("");
    }
  },[courseKey,catalog]);

  const restart=useCallback(async()=>{
    if(!selected)return;
    setBusy("open");setNotice("");setResult(null);setDraft({});setSaved({});setSubmissionCheck(false);
    try{
      const started=await masteryStartRound(courseKey,selected.knowledge_id);
      setRound(started);
    }catch(cause){
      setNotice(friendlyBridgeError(cause));
    }finally{
      setBusy("");
    }
  },[courseKey,selected]);

  const dirtyIds=useMemo(()=>{
    if(!round)return [];
    return round.questions
      .map(item=>String(item.question_id))
      .filter(id=>draft[id]!==undefined&&!saved[id]);
  },[round,draft,saved]);

  const persistDrafts=useCallback(async(targetIds:string[])=>{
    if(!round||!selected)return true;
    let ok=true;
    for(const id of targetIds){
      const value=draft[id];
      if(value===undefined)continue;
      setBusy("save");
      try{
        await masterySaveAnswer(courseKey,selected.knowledge_id,id,value);
        setSaved(previous=>({...previous,[id]:true}));
      }catch(cause){
        ok=false;
        setSaved(previous=>({...previous,[id]:false}));
        setNotice(friendlyBridgeError(cause));
        break;
      }
    }
    setBusy("");
    return ok;
  },[courseKey,draft,round,selected]);

  const saveOnly=useCallback(async()=>{
    if(!dirtyIds.length){setNotice("还没有需要保存的改动。");return;}
    const ok=await persistDrafts(dirtyIds);
    if(ok)setNotice(`已保存 ${dirtyIds.length} 道题；提交后才会算分。`);
  },[dirtyIds,persistDrafts]);

  const submitRound=useCallback(async()=>{
    if(!round||!selected)return;
    if(!submissionCheck){
      const pending=round.questions
        .map(item=>String(item.question_id))
        .filter(id=>draft[id]===undefined);
      if(pending.length){setNotice(`还有 ${pending.length} 道题没有作答；可以先只提交已答部分。`);}
      if(dirtyIds.length){
        const ok=await persistDrafts(dirtyIds);
        if(!ok)return;
      }
    }
    setBusy("submit");setNotice("");
    try{
      const submitted=await masterySubmitRound(courseKey,selected.knowledge_id);
      setLastQuestions(round.questions);
      setResult(submitted);
      setRound(null);setSubmissionCheck(false);
      await loadCatalog();
    }catch(cause){
      const code=cause instanceof Error?cause.message:"";
      if(code==="SUBMIT_STATUS_UNKNOWN"||code==="SUBMIT_IN_PROGRESS")setSubmissionCheck(true);
      setNotice(friendlyBridgeError(cause));
    }finally{
      setBusy("");
    }
  },[courseKey,dirtyIds,loadCatalog,persistDrafts,round,selected,submissionCheck]);

  const recheckResult=useCallback(async()=>{
    if(!selected)return;
    setBusy("verify");setNotice("");
    try{
      const checked=await masterySubmitRound(courseKey,selected.knowledge_id);
      setResult(checked);
      await loadCatalog();
    }catch(cause){
      setNotice(friendlyBridgeError(cause));
    }finally{
      setBusy("");
    }
  },[courseKey,loadCatalog,selected]);

  const discard=useCallback(async()=>{
    if(!selected)return;
    setBusy("discard");
    try{
      await masteryDiscardRound(courseKey,selected.knowledge_id);
      setRound(null);setResult(null);setDraft({});setSaved({});
      setNotice("已放弃这一轮；服务器上的卷子保留，掌握度不变。");
    }catch(cause){
      setNotice(friendlyBridgeError(cause));
    }finally{
      setBusy("");
    }
  },[courseKey,selected]);

  function toggleOption(questionId:number,optionId:number,multi:boolean){
    const key=String(questionId);
    setDraft(previous=>{
      if(!multi)return {...previous,[key]:optionId};
      const current=previous[key];
      const list=Array.isArray(current)?current.slice():[];
      const index=list.indexOf(optionId);
      if(index>=0)list.splice(index,1);else list.push(optionId);
      return {...previous,[key]:list};
    });
    setSaved(previous=>({...previous,[key]:false}));
  }

  return <section className="sf-mastery" aria-label="AI 掌握度">
    <header className="sf-mastery-head">
      <div>
        <span className="eyebrow">AI 掌握度</span>
        <h3>{courseTitle||catalog?.course_name||"知识点掌握度"}</h3>
        <p className="sf-muted">
          知识点练习卷。答完保存并提交，服务端才会计分并更新掌握度。
          {catalog?` 共 ${catalog.count} 个知识点，其中 ${catalog.pending_count} 个未达标。`:""}
        </p>
      </div>
      <div className="sf-mastery-head-actions">
        <button className="secondary" type="button" disabled={loading||Boolean(busy)} onClick={()=>void loadCatalog()}>
          <RefreshCw size={14}/>{loading?"读取中…":"刷新掌握度"}
        </button>
      </div>
    </header>

    {error&&<p className="sf-mastery-error" role="alert">{error}</p>}
    {notice&&<p className="sf-mastery-notice" role="status">{notice}</p>}

    <div className="sf-mastery-auto" aria-label="掌握度后台自动任务">
      <div className="sf-mastery-auto-head">
        <div>
          <h4>后台自动习题</h4>
          <p className="sf-muted">
            题库优先，AI 可选。自动读取、解题、保存、提交及回读服务器掌握度，
            无可靠答案或结果未确认时停止，不伪造完成。
          </p>
        </div>
        <strong>{auto?.phase||"未启动"}</strong>
      </div>
      <div className="sf-mastery-auto-controls">
        <label>目标掌握度
          <input type="number" min={1} max={100} value={autoTarget}
            disabled={autoBusy||Boolean(auto?.running)}
            onChange={event=>setAutoTarget(Number(event.target.value))}/>
        </label>
        <label>单知识点最多轮次
          <input type="number" min={1} max={10} value={autoRounds}
            disabled={autoBusy||Boolean(auto?.running)}
            onChange={event=>setAutoRounds(Number(event.target.value))}/>
        </label>
        <label>任务范围
          <select value={autoKnowledge} disabled={autoBusy||Boolean(auto?.running)}
            onChange={event=>setAutoKnowledge(event.target.value)}>
            <option value="">所有未达标知识点</option>
            {(catalog?.knowledge||[]).filter(item=>!item.free_exam).map(item=>
              <option key={item.knowledge_id} value={item.knowledge_id}>{item.name}</option>)}
          </select>
        </label>
        <label className="sf-mastery-auto-check">
          <input type="checkbox" checked={autoNext}
            disabled={autoBusy||Boolean(auto?.running)}
            onChange={event=>setAutoNext(event.target.checked)}/> 自动继续下一知识点
        </label>
        <label className="sf-mastery-auto-check">
          <input type="checkbox" checked={autoAi}
            disabled={autoBusy||Boolean(auto?.running)}
            onChange={event=>setAutoAi(event.target.checked)}/> 题库未命中时使用 DeepSeek
        </label>
        {autoAi&&<label className="sf-mastery-auto-key">DeepSeek API Key（仅本次任务使用）
          <input type="password" autoComplete="off" value={autoKey}
            disabled={autoBusy||Boolean(auto?.running)}
            onChange={event=>setAutoKey(event.target.value)}
            placeholder="填写本人的 DeepSeek API Key"/>
        </label>}
      </div>
      {autoAi&&<p className="sf-muted">启用 AI 会向 DeepSeek 发送当前习题题干与选项；密钥不写入本地配置。</p>}
      <div className="sf-mastery-round-actions">
        {!auto?.running
          ?<button type="button" disabled={autoBusy||!desktop||!catalog||(autoAi&&!autoKey.trim())}
              onClick={()=>void startAuto()}>启动后台自动习题</button>
          :<>
            {auto.state==="paused"
              ?<button className="secondary" type="button" disabled={autoBusy}
                  onClick={()=>void controlAuto("resume")}>继续</button>
              :<button className="secondary" type="button" disabled={autoBusy||auto.state==="stopping"}
                  onClick={()=>void controlAuto("pause")}>暂停</button>}
            <button type="button" disabled={autoBusy||auto.state==="stopping"}
              onClick={()=>void controlAuto("stop")}>停止</button>
          </>}
      </div>
      {autoError&&<p className="sf-mastery-error" role="alert">{autoError}</p>}
      {auto&&<div className="sf-mastery-auto-status" role="status">
        <p>{auto.message||auto.phase}</p>
        <p>知识点 {auto.points_done}/{auto.points_total} · 轮次 {auto.round} ·
          当前掌握度 {auto.mastery??"—"} · 题库 {auto.bank_hit} ·
          AI 解题 {auto.ai_count}（请求 {auto.ai_calls}）</p>
        {auto.knowledge&&<p>当前：{auto.knowledge}</p>}
        {auto.logs?.length>0&&<ul>{auto.logs.slice(-6).map((line,index)=>
          <li key={index}>{line}</li>)}</ul>}
      </div>}
    </div>

    {!round&&!result&&<div className="sf-mastery-body">
      <ul className="sf-mastery-list">
        {(catalog?.knowledge??[]).map(item=>{
          const value=item.mastery??null;
          const active=selected?.knowledge_id===item.knowledge_id;
          return <li key={item.knowledge_id} className={active?"is-active":undefined}>
            <button type="button" className="sf-mastery-row" onClick={()=>void openKnowledge(item)}>
              <span className={`sf-mastery-dot ${bandClass(value)}`} aria-hidden="true"/>
              <span className="sf-mastery-row-main">
                <strong>{item.name}</strong>
                <small>{item.theme||"知识点"}{item.free_exam?" · 免考":""}</small>
              </span>
              <span className="sf-mastery-row-meta">
                <span className="sf-mastery-score">
                  {value===null?"—":value}
                  <em>{value===null?"未读取":"分"}</em>
                </span>
                <small>{value===null?(item.mastery_error||""):(BAND_LABEL[item.band||"low"]||"")}</small>
              </span>
              <span className="sf-mastery-row-progress">学习进度 {item.study_progress}%</span>
            </button>
          </li>;
        })}
        {catalog&&catalog.knowledge.length===0&&<li className="sf-mastery-empty">
          这门课程还没有可练习的知识点。
        </li>}
        {loading&&!catalog&&<li className="sf-mastery-empty">正在读取知识点与掌握度…</li>}
      </ul>
    </div>}

    {round&&<div className="sf-mastery-round">
      <div className="sf-mastery-round-head">
        <div>
          <span className="eyebrow">{selected?.name||""}</span>
          <h4>本轮 {round.questions.length} 题 · 卷号 {round.exam_test_id}</h4>
          <p className="sf-muted">
            历史最高掌握度 {round.high_mastery??"—"} 分；阈值 {round.threshold} 分。
            这一轮的得分要等提交后才会出来。
          </p>
        </div>
        <div className="sf-mastery-round-actions">
          <button className="secondary" type="button" disabled={Boolean(busy)} onClick={()=>void discard()}>放弃本轮</button>
          <button className="secondary" type="button" disabled={Boolean(busy)||submissionCheck||!dirtyIds.length} onClick={()=>void saveOnly()}>
            {busy==="save"?"保存中…":`保存答案${dirtyIds.length?`（${dirtyIds.length}）`:""}`}
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={()=>void submitRound()}>
            {busy==="submit"?"核验中…":submissionCheck?"核验提交状态":"提交本轮"}
          </button>
        </div>
      </div>

      <ol className="sf-mastery-questions">
        {round.questions.map((question,index)=>{
          const key=String(question.question_id);
          const multi=question.question_type===2;
          const fill=question.question_type===3||question.options.length===0;
          const value=draft[key];
          return <li key={key} className="sf-mastery-question">
            <div className="sf-mastery-question-head">
              <span className="sf-mastery-index">{index+1}</span>
              <span className="sf-mastery-type">{typeLabel(question.question_type)}</span>
              {saved[key]&&<span className="sf-mastery-saved"><CheckCircle2 size={13}/>已保存</span>}
            </div>
            <p className="sf-mastery-stem">{question.content}</p>
            {fill?<input className="sf-mastery-fill" type="text"
              placeholder="多个空用 | 分隔，例如：生产力|生产关系"
              disabled={submissionCheck}
              value={typeof value==="string"?value:(Array.isArray(value)?value.join("|"):"")}
              onChange={event=>{
                const raw=event.target.value;
                const parts=raw.split("|").map(part=>part.trim()).filter(Boolean);
                setDraft(previous=>({...previous,[key]:parts.length>1?parts:raw}));
                setSaved(previous=>({...previous,[key]:false}));
              }}/>
            :<ul className="sf-mastery-options">
              {question.options.map(option=>{
                const picked=multi
                  ?Array.isArray(value)&&value.includes(option.id)
                  :value===option.id;
                return <li key={option.id}>
                  <label className={picked?"is-picked":undefined}>
                    <input type={multi?"checkbox":"radio"} name={key} checked={picked} disabled={submissionCheck}
                      onChange={()=>toggleOption(question.question_id,option.id,multi)}/>
                    <span>{option.content||`选项 ${option.sort??""}`}</span>
                  </label>
                </li>;
              })}
            </ul>}
          </li>;
        })}
      </ol>
    </div>}

    {result&&<div className="sf-mastery-result">
      <div className="sf-mastery-result-head">
        <div>
          <span className="eyebrow">{selected?.name||""}</span>
          <h4>
            {result.grading_pending?"本轮判分待确认":`本轮 ${result.round_score.correct}/${result.round_score.total}`}
            {!result.grading_pending&&result.round_score.percent!==null?` · ${result.round_score.percent}%`:""}
          </h4>
          <p className="sf-muted">
            这是本轮正确率，不是历史最高掌握度（历史最高 {result.mastery_before.high??"—"} 分）。
          </p>
        </div>
        <div className="sf-mastery-round-actions">
          <button className="secondary" type="button" onClick={()=>{setResult(null);setSelected(null);}}>返回知识点</button>
          {result.verification_pending&&<button type="button" disabled={Boolean(busy)}
            onClick={()=>void recheckResult()}>{busy==="verify"?"核验中…":"重新核对结果"}</button>}
          <button type="button" disabled={Boolean(busy)||result.verification_pending}
            onClick={()=>void restart()}>再练一轮</button>
        </div>
      </div>

      {result.verification_pending&&<p className="sf-mastery-notice" role="status">
        本轮已发送提交，但判分或掌握度回读尚不完整。可重新核对结果，不会重复提交习题。
      </p>}
      <dl className="sf-mastery-mastery">
        <div>
          <dt>本轮开始前</dt>
          <dd>{result.mastery_before.high??"—"}</dd>
        </div>
        <div>
          <dt>提交后掌握度</dt>
          <dd>{result.mastery_after?result.mastery_after.mastery:(result.mastery_error?"读取失败":"—")}</dd>
        </div>
        <div>
          <dt>当前历史最高</dt>
          <dd>{result.high_mastery_now??"—"}</dd>
        </div>
        <div>
          <dt>阈值 {result.threshold} 分</dt>
          <dd>{result.reached_threshold?"已达标":"未达标"}</dd>
        </div>
      </dl>
      <p className="sf-mastery-hint">
        {result.next_round_hint==="reached"?"已超过官方达标线，可以不再练这一个知识点。"
          :result.next_round_hint==="study_first"?"掌握度偏低，官方页面会同时推荐先学资源，再回来练更划算。"
          :"继续练下一轮，掌握度按服务器判定更新。"}
      </p>

      <ol className="sf-mastery-graded">
        {result.graded.map((item,index)=>{
          const question=lastQuestions.find(entry=>entry.question_id===item.questionId)
            ??{question_id:item.questionId,content:`题目 ${item.questionId}`,question_type:item.questionType,type_name:"",options:[]};
          return <li key={item.questionId} className={item.isCorrect?"is-correct":"is-wrong"}>
            <div className="sf-mastery-question-head">
              <span className="sf-mastery-index">{index+1}</span>
              <span className="sf-mastery-type">{typeLabel(item.questionType)}</span>
              {item.isCorrect?<span className="sf-mastery-ok"><CheckCircle2 size={14}/>正确</span>
                :<span className="sf-mastery-bad"><XCircle size={14}/>错误</span>}
            </div>
            <p className="sf-mastery-stem">{question.content}</p>
            <p className="sf-mastery-answer">
              你的答案：{item.answers.map(entry=>entry.answer).join(" / ")||"（空）"}
            </p>
            {item.correctTexts.length>0&&<p className="sf-mastery-correct">
              正确答案：{item.correctTexts.join(" / ")}
            </p>}
            {item.analysis&&<p className="sf-mastery-analysis">
              <CircleHelp size={13}/>{item.analysis}
            </p>}
          </li>;
        })}
      </ol>
    </div>}

    <footer className="sf-mastery-foot">
      <BookOpen size={14}/>
      <span>数据来源：{catalog?.verified_at?catalog.verified_at.slice(0,19).replace("T"," "):"—"} ·
        掌握度读取走只读接口，不会因为查看而新建试卷。</span>
      {selected&&!round&&!result&&<button className="text-button" type="button" disabled={Boolean(busy)} onClick={()=>void restart()}>
        <Play size={13}/>开始练习
      </button>}
    </footer>
  </section>;
}
