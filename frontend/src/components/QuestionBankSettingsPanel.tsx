import {useEffect,useMemo,useRef,useState,type MouseEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
import {ChevronRight,ExternalLink,Plus,RefreshCw} from "lucide-react";
import {
  friendlyBridgeError,questionBankCheckToken,questionBankImportTokens,questionBankList,
  questionBankRemoveToken,questionBankSelectToken,questionBankSetRotation,
  type QuestionBankState,type QuestionBankToken,
} from "../bridge";
import {SettingsDialog} from "../ui/SettingsDialog";
import {announceQuestionBankConfigChanged} from "../questionBankChangeSignal";
import {ConfirmDialog} from "../ui/ConfirmDialog";
import "./QuestionBank.css";

type Job={done:number;total:number;failed:number;quota:boolean};
type ProviderStats={tokens:number;valid:number;invalid:number;unknown:number;known:number;remaining:number};
function summarize(tokens:QuestionBankToken[]):ProviderStats{
  const usable=tokens.filter(t=>t.validity!=="invalid");
  return {
    tokens:tokens.length,
    valid:tokens.filter(t=>t.validity==="valid").length,
    invalid:tokens.filter(t=>t.validity==="invalid").length,
    unknown:tokens.filter(t=>t.validity!=="valid"&&t.validity!=="invalid").length,
    known:usable.filter(t=>typeof t.remaining==="number"&&t.remaining>=0).length,
    remaining:usable.reduce((total,t)=>total+(typeof t.remaining==="number"&&t.remaining>=0?t.remaining:0),0),
  };
}
function quotaLabel(stats:ProviderStats,unit="次"){
  return stats.known===0?"未知":stats.remaining.toLocaleString()+" "+unit;
}
function statusLabel(token:QuestionBankToken){
  if(token.validity==="valid")return "已识别可用";
  if(token.validity==="invalid")return "服务拒绝";
  if(token.validity==="unknown")return "无法确认";
  return "未检测";
}
function dateLabel(value?:string|null){
  if(!value)return "";
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString();
}

/** Compact cross-platform question-bank control center. Querying remains in course features. */
export function QuestionBankSettingsPanel({desktop,dark=false}:{desktop:boolean;dark?:boolean}){
  const [state,setState]=useState<QuestionBankState>({providers:[],tokens:[]});
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [tokenLines,setTokenLines]=useState("");
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [checkingId,setCheckingId]=useState("");
  const [job,setJob]=useState<Job|null>(null);
  const [quotaConfirm,setQuotaConfirm]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const mounted=useRef(true);
  const listReadId=useRef(0);

  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;};
  },[]);
  useEffect(()=>{
    if(!desktop)return;
    const readId=++listReadId.current;
    setLoading(true);
    void questionBankList().then(data=>{
      if(mounted.current&&readId===listReadId.current)setState(data);
    }).catch(cause=>{
      if(mounted.current&&readId===listReadId.current)
        setError(friendlyBridgeError(cause));
    }).finally(()=>{
      if(mounted.current&&readId===listReadId.current)setLoading(false);
    });
    return ()=>{listReadId.current++;};
  },[desktop]);

  async function refreshList(){
    if(!desktop||busy||refreshing)return;
    // A newer manual read supersedes a hanging initial request. Its late
    // response cannot overwrite the displayed providers or token counts.
    const readId=++listReadId.current;
    setRefreshing(true);setError("");setNotice("");
    try{
      const next=await questionBankList();
      if(!mounted.current||readId!==listReadId.current)return;
      setState(next);
      setNotice("已重新载入本机题库和 Token 配置。");
    }catch(cause){
      if(mounted.current&&readId===listReadId.current)
        setError(friendlyBridgeError(cause));
    }finally{
      if(mounted.current&&readId===listReadId.current){
        setLoading(false);setRefreshing(false);
      }
    }
  }

  const selected=state.providers.find(p=>p.id===selectedId);
  const selectedTokens=state.tokens.filter(t=>t.provider_id===selectedId);
  const selectedStats=summarize(selectedTokens);
  const allStats=useMemo(()=>summarize(state.tokens),[state.tokens]);
  const units=state.providers.filter(p=>state.tokens.some(t=>t.provider_id===p.id&&t.validity!=="invalid"
    &&typeof t.remaining==="number"&&t.remaining>=0)).map(p=>p.quota_unit||"次");
  const globalQuota=allStats.known===0?"未知":new Set(units).size>1
    ?"按题库分别统计":quotaLabel(allStats,units[0]||"次");
  const eligible=state.tokens.filter(t=>state.providers.some(p=>p.id===t.provider_id&&p.supports_check!==false));
  const rotation=selected?state.rotation_modes?.[selected.id]||"fixed":"fixed";

  async function runAll(quota:boolean){
    if(busy||loading||refreshing||eligible.length===0)return;
    setQuotaConfirm(false);setBusy(true);setError("");setNotice("");
    let done=0,failed=0;
    setJob({done,total:eligible.length,failed,quota});
    for(const token of eligible){
      if(!mounted.current)break;
      setCheckingId(token.id);
      try{
        const next=await questionBankCheckToken(token.id,quota);
        if(!mounted.current)break;
        setState(next);
      }catch{
        failed++;
      }
      done++;
      if(mounted.current)setJob({done,total:eligible.length,failed,quota});
    }
    if(!mounted.current)return;
    setCheckingId("");setJob(null);setBusy(false);
    setNotice("检测完成："+done+" 条，失败 "+failed+" 条。余量以题库实际返回的数据为准。");
  }
  async function checkOne(id:string,quota=false){
    if(busy||loading||refreshing)return;
    setBusy(true);setCheckingId(id);setError("");setNotice("");
    try{
      setState(await questionBankCheckToken(id,quota));
      setNotice(quota?"已更新该 Token 可取得的余量信息。":"已完成单条状态检测。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);setCheckingId("");}
  }
  async function importBatch(){
    if(busy||loading||refreshing||!selected||!tokenLines.trim())return;
    setBusy(true);setError("");setNotice("");
    try{
      const next=await questionBankImportTokens(selected.id,tokenLines);
      setState(next);setTokenLines("");
      if((next.added??0)>0)announceQuestionBankConfigChanged();
      setNotice("已导入 "+(next.added??0)+" 条，跳过重复 "+(next.skipped??0)+" 条。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  }
  async function setRotation(mode:"fixed"|"round_robin"){
    if(busy||loading||refreshing||!selected)return;
    setBusy(true);setError("");setNotice("");
    try{
      setState(await questionBankSetRotation(selected.id,mode));
      announceQuestionBankConfigChanged();
    }
    catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  }
  async function selectToken(id:string){
    if(busy||loading||refreshing)return;
    setBusy(true);setError("");setNotice("");
    try{
      setState(await questionBankSelectToken(id));
      announceQuestionBankConfigChanged();
    }
    catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  }
  async function removeToken(id:string){
    if(busy||loading||refreshing)return;
    setBusy(true);setError("");setNotice("");
    try{
      setState(await questionBankRemoveToken(id));
      announceQuestionBankConfigChanged();
      setNotice("Token 已从本机加密保险库中删除。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  }
  function openHomepage(event:MouseEvent<HTMLAnchorElement>,url:string){
    event.preventDefault();setError("");
    void invoke("studyflow_open_question_bank_site",{url}).catch(()=>{
      if(mounted.current)setError("暂时无法打开题库官网，请检查系统默认浏览器。");
    });
  }
  function openProvider(id:string){
    setSelectedId(id);setTokenLines("");setError("");setNotice("");
  }

  if(!desktop)return <section className="sf-qb-hub"><p>题库中心仅在 Windows EXE 中可用。</p></section>;
  return <section className="sf-qb-hub" aria-label="题库中心">
    <div className="sf-qb-hub-top">
      <div><strong>共享题库</strong><p>统一管理多个来源，供知到及后续接入的学习平台调用。</p></div>
      <div className="sf-qb-hub-actions">
        <button type="button" className="secondary" disabled={busy||refreshing}
          onClick={()=>void refreshList()}><RefreshCw size={14}/>{refreshing?"刷新中…":"刷新列表"}</button>
        <button type="button" className="secondary" disabled={busy||loading||refreshing||eligible.length===0}
          onClick={()=>void runAll(false)}><RefreshCw size={14}/>检测全部</button>
        <button type="button" className="secondary" disabled={busy||loading||refreshing||eligible.length===0}
          onClick={()=>setQuotaConfirm(true)}>检测并更新余量</button>
      </div>
    </div>
    <div className="sf-qb-overview" aria-label="全部题库汇总">
      <div><span>题库来源</span><strong>{state.providers.length}</strong></div>
      <div><span>已保存 Token</span><strong>{allStats.tokens}</strong></div>
      <div><span>已识别可用</span><strong>{allStats.valid}<small> / {allStats.tokens}</small></strong></div>
      <div><span>已知剩余总量</span><strong>{globalQuota}</strong>
        <small>{allStats.known} / {allStats.tokens} 条有余量记录</small></div>
    </div>
    <p className="sf-qb-hub-note">状态：{allStats.invalid} 条服务拒绝，{allStats.unknown} 条未检测或无法确认。总余量仅汇总有数值且未被判无效的 Token，并非实时保证值。</p>
    {job&&<div role="status" className="sf-qb-job">
      <span>{job.quota?"检测状态与余量":"检测可用性"}：{job.done} / {job.total}，请求失败 {job.failed}</span>
      <progress max={job.total} value={job.done}/>
    </div>}
    {loading&&<p className="sf-qb-hub-note">正在读取本机题库配置…</p>}
    <div className="sf-qb-provider-list" aria-label="已接入题库">
      {state.providers.map(provider=>{
        const stats=summarize(state.tokens.filter(t=>t.provider_id===provider.id));
        return <article className="sf-qb-provider" key={provider.id}>
          <div className="sf-qb-provider-main">
            <div className="sf-qb-provider-name"><strong>{provider.name}</strong>
              {provider.homepage&&<a href={provider.homepage} target="_blank"
                rel="noopener noreferrer" aria-label={provider.name+" 官网"}
                onClick={event=>openHomepage(event,provider.homepage||"")}><ExternalLink size={13}/>官网</a>}
            </div>
            <div className="sf-qb-provider-meta">
              <span>Token {stats.tokens}</span><span>可用 {stats.valid}</span>
              <span>剩余 {quotaLabel(stats,provider.quota_unit||"次")}</span>
            </div>
          </div>
          <button className="secondary sf-qb-manage" type="button" disabled={busy||loading||refreshing}
            onClick={()=>openProvider(provider.id)}>管理 <ChevronRight size={15}/></button>
        </article>;
      })}
    </div>
    {state.providers.length===0&&!loading&&<p className="sf-qb-hub-note">还没有接入题库适配器。添加新的来源后会自动出现在这里。</p>}
    {error&&<p className="sf-qb-error" role="alert">{error}</p>}
    {notice&&<p className="sf-qb-hub-note" role="status">{notice}</p>}
    <p className="sf-qb-hub-note">“检测全部”只验证状态；“检测并更新余量”可能因题库规则消耗查询额度，不会定时自动执行。</p>

    <SettingsDialog open={Boolean(selected)} dark={dark} kicker="题库中心 · 来源管理"
      title={selected?.name||"题库管理"} onClose={()=>{setSelectedId(null);setTokenLines("");}}>
      {selected&&<div className="sf-qb-details">
        <div className="sf-qb-detail-summary">
          <span>Token {selectedStats.tokens}</span><span>已识别可用 {selectedStats.valid}</span>
          <span>已知余额 {quotaLabel(selectedStats,selected.quota_unit||"次")}</span>
          {selected.homepage&&<a href={selected.homepage} target="_blank" rel="noopener noreferrer"
            onClick={event=>openHomepage(event,selected.homepage||"")}><ExternalLink size={13}/>访问题库官网</a>}
        </div>
        {error&&<p role="alert" className="sf-qb-error">{error}</p>}
        <div className="sf-qb-detail-toolbar">
          <label>Token 使用策略
            <select value={rotation} disabled={busy||loading||refreshing}
              onChange={event=>void setRotation(event.target.value as "fixed"|"round_robin")}>
              <option value="round_robin">自动轮流</option>
              <option value="fixed">固定默认</option>
            </select>
          </label>
        </div>
        <div className="sf-qb-token-rows">
          {selectedTokens.length===0&&<p className="sf-qb-hub-note">尚无 Token。可在下方一次粘贴多条。</p>}
          {selectedTokens.map(token=><div className="sf-qb-token-row" key={token.id}>
            <div className="sf-qb-token-info">
              <strong>{token.label}{token.active?" · 默认":""}</strong>
              <span>{statusLabel(token)} · 剩余 {typeof token.remaining==="number"&&token.validity!=="invalid"
                ?token.remaining+" "+(selected.quota_unit||"次"):"未知"}</span>
              {token.checked_at&&<small>检测：{dateLabel(token.checked_at)}</small>}
              {token.balance_at&&<small>余量更新：{dateLabel(token.balance_at)}</small>}
            </div>
            <div className="sf-qb-token-actions">
              {selected.supports_check!==false&&<button className="secondary" type="button" disabled={busy||loading||refreshing}
                onClick={()=>void checkOne(token.id)}>{checkingId===token.id?"检测中…":"检测"}</button>}
              <button className="secondary" type="button" disabled={busy||loading||refreshing||token.active}
                onClick={()=>void selectToken(token.id)}>{token.active?"默认":"设默认"}</button>
              <button className="secondary" type="button" disabled={busy||loading||refreshing}
                aria-label={"删除 Token "+token.label} onClick={()=>void removeToken(token.id)}>删除</button>
            </div>
          </div>)}
        </div>
        <div className="sf-qb-import">
          <div><strong><Plus size={14}/>批量导入 Token</strong>
            <p>一行一条，自动去重并加密保存；不会显示原文。</p></div>
          <textarea rows={4} maxLength={65000} autoComplete="off" spellCheck={false}
            className="sf-qb-secret-lines" value={tokenLines} disabled={busy||loading||refreshing}
            placeholder={"第 1 条 Token\n第 2 条 Token\n第 3 条 Token"}
            onChange={event=>setTokenLines(event.target.value)}/>
          <button type="button" disabled={busy||loading||refreshing||!tokenLines.trim()} onClick={()=>void importBatch()}>
            批量导入并加密保存
          </button>
        </div>
      </div>}
    </SettingsDialog>
    <ConfirmDialog open={quotaConfirm} dark={dark} title="检测全部 Token 并更新余量"
      description={"将检查 "+eligible.length+" 条 Token 的有效性，并尝试读取实际剩余额度。"}
      warning="部分题库的余量检测可能消耗查询次数；无法获取的余量仍显示未知。"
      confirmLabel="继续检测" onConfirm={()=>void runAll(true)} onCancel={()=>setQuotaConfirm(false)}/>
  </section>;
}
