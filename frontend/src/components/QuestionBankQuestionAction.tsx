import {useEffect,useRef,useState} from "react";
import {announceQuestionBankConfigChanged} from "../questionBankChangeSignal";
import {
  friendlyBridgeError,questionBankList,questionBankQuery,
  type QuestionBankAnswer,type QuestionBankQuestion,type QuestionBankState,
} from "../bridge";
import "./QuestionBank.css";

/**
 * A provider-independent inline action. Any ordinary homework or practice UI
 * can render <QuestionBankQuestionAction question={normalizedQuestion} />.
 * It is read-only and never interacts with the platform's answer submission.
 */
export function QuestionBankQuestionAction({desktop,question}:{
  desktop:boolean;question:QuestionBankQuestion;
}){
  // The same question row can be reused for another round. An old async
  // answer must never be displayed for a different stem, options or type.
  const questionKey=JSON.stringify([question.title,question.question_type??"",question.options??[]]);
  const visit=useRef({key:questionKey,revision:0});
  const listReadId=useRef(0);
  const answerReadId=useRef(0);
  if(visit.current.key!==questionKey){
    visit.current={key:questionKey,revision:visit.current.revision+1};
    listReadId.current++;
    answerReadId.current++;
  }
  const revision=visit.current.revision;
  const mounted=useRef(false);
  const [openRevision,setOpenRevision]=useState<number|null>(null);
  const open=openRevision===revision;
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [state,setState]=useState<QuestionBankState>({providers:[],tokens:[]});
  const [provider,setProvider]=useState("");
  const [tokenId,setTokenId]=useState("");
  const [error,setError]=useState("");
  const [result,setResult]=useState<{revision:number;answer:QuestionBankAnswer}|null>(null);
  const visibleResult=result?.revision===revision?result.answer:null;

  useEffect(()=>{
    mounted.current=true;
    return ()=>{
      mounted.current=false;
      listReadId.current++;
      answerReadId.current++;
    };
  },[]);
  useEffect(()=>{
    // A different question starts closed, with no previous answer or pending
    // indicator. The revision guard also invalidates late callbacks instantly.
    setOpenRevision(null);setLoading(false);setBusy(false);
    setState({providers:[],tokens:[]});setProvider("");setTokenId("");
    setError("");setResult(null);
  },[revision]);

  const reveal=async()=>{
    if(!desktop||busy)return;
    if(open){
      listReadId.current++;
      setOpenRevision(null);setLoading(false);
      return;
    }
    const requestId=++listReadId.current;
    const isCurrent=()=>mounted.current&&visit.current.revision===revision
      &&listReadId.current===requestId;
    setOpenRevision(revision);setLoading(true);setError("");setResult(null);
    try{
      const saved=await questionBankList();
      if(!isCurrent())return;
      setState(saved);
      const available=saved.providers.filter(p=>saved.tokens.some(t=>t.provider_id===p.id));
      const target=available[0]?.id||saved.providers[0]?.id||"";
      setProvider(target);
      setTokenId("");
    }catch(cause){
      if(isCurrent())setError(friendlyBridgeError(cause));
    }finally{
      if(isCurrent())setLoading(false);
    }
  };
  const chooseProvider=(id:string)=>{
    setProvider(id);
    setTokenId("");
    setResult(null);setError("");
  };
  const query=async()=>{
    if(busy||loading||!open||!provider||!tokens.length||!question.title.trim())return;
    const requestId=++answerReadId.current;
    const isCurrent=()=>mounted.current&&visit.current.revision===revision
      &&answerReadId.current===requestId;
    setBusy(true);setError("");setResult(null);
    try{
      const answer=await questionBankQuery(provider,question,tokenId);
      if(isCurrent())setResult({revision,answer});
      // The lookup can update the vault even if the user moved to another
      // question. Refresh shared balances, but never show its stale answer.
      if(typeof answer.remaining==="number"&&answer.remaining>=0)
        announceQuestionBankConfigChanged();
    }catch(cause){
      if(isCurrent())setError(friendlyBridgeError(cause));
    }finally{
      if(isCurrent())setBusy(false);
    }
  };
  const tokens=state.tokens.filter(t=>t.provider_id===provider);

  if(!desktop)return null;
  return <div className="sf-qb-inline" aria-label="题目通用题库查询">
    <button className="secondary sf-qb-inline-trigger" type="button"
      aria-expanded={open} onClick={()=>void reveal()}>
      {open?"收起题库":"题库查题"}
    </button>
    {open&&<div className="sf-qb-inline-body">
      {loading&&<p className="sf-qb-hint">正在读取本机题库…</p>}
      {!loading&&state.providers.length===0&&<p className="sf-qb-hint">暂无可用题库，请在全局设置中配置。</p>}
      {!loading&&state.providers.length>0&&<>
        <div className="sf-qb-inline-selects">
          <label>题库来源
            <select value={provider} disabled={busy} onChange={e=>chooseProvider(e.target.value)}>
              {state.providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Token 使用方式
            <select value={tokenId} disabled={busy||tokens.length===0}
              onChange={e=>{setTokenId(e.target.value);setResult(null);}}>
              <option value="">{tokens.length===0?"尚未配置":"按题库策略自动选择"}</option>
              {tokens.map(t=><option key={t.id} value={t.id}>{t.label}{t.active?"（默认）":""}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy||loading||tokens.length===0||!question.title.trim()}
            onClick={()=>void query()}>{busy?"查询中…":"查询这道题"}</button>
        </div>
        <p className="sf-qb-hint">每次仅使用本题库的一条 Token；可自动轮流或手动固定。结果仅供核对，不自动提交。</p>
      </>}
      {error&&<p role="alert" className="sf-qb-error">{error}</p>}
      {visibleResult&&<div className="sf-qb-answer" role="status">
        {visibleResult.found
          ?<><strong>{visibleResult.provider_name} · 参考答案（未核验）</strong>
            <pre>{visibleResult.answer}</pre></>
          :<strong>当前题库未找到该题的参考答案</strong>}
        <small>查询 Token：{visibleResult.token_label}{visibleResult.remaining!==null?" · 剩余次数："+visibleResult.remaining:""}</small>
      </div>}
    </div>}
  </div>;
}
