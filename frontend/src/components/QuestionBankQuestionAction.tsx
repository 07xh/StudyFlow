import {useState} from "react";
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
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [state,setState]=useState<QuestionBankState>({providers:[],tokens:[]});
  const [provider,setProvider]=useState("");
  const [tokenId,setTokenId]=useState("");
  const [error,setError]=useState("");
  const [result,setResult]=useState<QuestionBankAnswer|null>(null);

  const reveal=async()=>{
    if(!desktop||busy)return;
    if(open){setOpen(false);return;}
    setOpen(true);setLoading(true);setError("");setResult(null);
    try{
      const saved=await questionBankList();
      setState(saved);
      const available=saved.providers.filter(p=>saved.tokens.some(t=>t.provider_id===p.id));
      const target=available[0]?.id||saved.providers[0]?.id||"";
      setProvider(target);
      setTokenId(saved.tokens.find(t=>t.provider_id===target&&t.active)?.id||"");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setLoading(false);}
  };
  const chooseProvider=(id:string)=>{
    setProvider(id);
    setTokenId(state.tokens.find(t=>t.provider_id===id&&t.active)?.id||"");
    setResult(null);setError("");
  };
  const query=async()=>{
    if(busy||!tokenId||!provider)return;
    setBusy(true);setError("");setResult(null);
    try{
      const answer=await questionBankQuery(provider,question,tokenId);
      setResult(answer);
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
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
          <label>Token
            <select value={tokenId} disabled={busy||tokens.length===0}
              onChange={e=>{setTokenId(e.target.value);setResult(null);}}>
              {tokens.length===0?<option value="">尚未配置</option>:
                tokens.map(t=><option key={t.id} value={t.id}>{t.label}{t.active?"（默认）":""}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy||!tokenId||!question.title.trim()}
            onClick={()=>void query()}>{busy?"查询中…":"查询这道题"}</button>
        </div>
        <p className="sf-qb-hint">将当前题目及选项发给所选题库。结果仅供核对，不会改写本题答案或自动提交。</p>
      </>}
      {error&&<p role="alert" className="sf-qb-error">{error}</p>}
      {result&&<div className="sf-qb-answer" role="status">
        {result.found
          ?<><strong>{result.provider_name} · 参考答案（未核验）</strong>
            <pre>{result.answer}</pre></>
          :<strong>当前题库未找到该题的参考答案</strong>}
        <small>查询 Token：{result.token_label}{result.remaining!==null?" · 剩余次数："+result.remaining:""}</small>
      </div>}
    </div>}
  </div>;
}
