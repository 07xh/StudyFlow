import {useEffect,useMemo,useState} from "react";
import {
  friendlyBridgeError,questionBankImportTokens,questionBankList,questionBankQuery,
  questionBankRemoveToken,questionBankSelectToken,questionBankSetRotation,
  type QuestionBankAnswer,type QuestionBankState,
} from "../bridge";
import "./QuestionBank.css";

/** Global provider and token management, shared by all learning platforms. */
export function QuestionBankSettingsPanel({desktop}:{desktop:boolean}){
  const [state,setState]=useState<QuestionBankState>({providers:[],tokens:[]});
  const [provider,setProvider]=useState("yanxi");
  const [tokenLines,setTokenLines]=useState("");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [title,setTitle]=useState("");
  const [options,setOptions]=useState("");
  const [questionType,setQuestionType]=useState("");
  const [answer,setAnswer]=useState<QuestionBankAnswer|null>(null);
  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    setLoading(true);
    void questionBankList().then(data=>{
      if(!active)return;
      setState(data);
      if(data.providers.length&&!data.providers.some(p=>p.id===provider))
        setProvider(data.providers[0].id);
    }).catch(cause=>{if(active)setError(friendlyBridgeError(cause));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[desktop]);

  const available=useMemo(()=>state.tokens.filter(item=>item.provider_id===provider),[state,provider]);
  const activeToken=available.find(item=>item.active);
  const rotation=state.rotation_modes?.[provider]||"fixed";

  const add=async()=>{
    if(busy||!tokenLines.trim())return;
    setBusy(true);setError("");setNotice("");
    try{
      const updated=await questionBankImportTokens(provider,tokenLines);
      setState(updated);setTokenLines("");
      setNotice(`已加密保存 ${updated.added??0} 条 Token，跳过重复 ${updated.skipped??0} 条；未返回任何密钥明文。`);
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  };
  const changeRotation=async(mode:"fixed"|"round_robin")=>{
    if(busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      setState(await questionBankSetRotation(provider,mode));
      setNotice(mode==="round_robin"
        ?"已启用轮流使用：每次新查询选下一条，错误不会触发额外换号重试。"
        :"已启用固定使用：始终使用当前默认 Token。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  };
  const select=async(id:string)=>{
    if(busy)return;
    setBusy(true);setError("");setNotice("");setAnswer(null);
    try{setState(await questionBankSelectToken(id));}
    catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  };
  const remove=async(id:string)=>{
    if(busy)return;
    setBusy(true);setError("");setNotice("");setAnswer(null);
    try{
      setState(await questionBankRemoveToken(id));
      setNotice("所选 Token 已从本机保险库中删除。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  };
  const query=async()=>{
    if(busy||!activeToken||!title.trim())return;
    setBusy(true);setError("");setNotice("");setAnswer(null);
    try{
      const result=await questionBankQuery(provider,{title:title.trim(),
        options:options.trim(),question_type:questionType});
      setAnswer(result);
      setNotice(result.found?"题库返回了参考内容，请与题目核对。":"当前题库未找到参考答案。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  };

  if(!desktop)return <section className="sf-qb-settings"><p>题库仅支持学序 Windows EXE 本地服务。</p></section>;
  return <section className="sf-qb-settings" aria-label="共享题库与 Token">
    <header className="sf-qb-header">
      <h3>题库与搜题</h3>
      <p>已接入的题库向所有支持的练习和作业栏目提供统一的查题接口。Token 只保存在本机 Windows 加密保险库中。</p>
    </header>
    <div className="sf-qb-fields">
      <label>题库来源
        <select value={provider} disabled={busy||loading} onChange={e=>{setProvider(e.target.value);setAnswer(null);setTokenLines("");}}>
          {state.providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="sf-qb-manager">
        <div className="sf-qb-token-toolbar">
          <strong>此题库的 Token（{available.length}）</strong>
          <label>使用策略
            <select value={rotation} disabled={busy||loading}
              onChange={e=>void changeRotation(e.target.value as "fixed"|"round_robin")}>
              <option value="round_robin">自动轮流使用</option>
              <option value="fixed">固定使用默认 Token</option>
            </select>
          </label>
        </div>
        {loading&&<p className="sf-qb-hint">正在读取本机题库配置…</p>}
        {!loading&&available.length===0&&<p className="sf-qb-hint">尚未配置。直接在下方粘贴全部 Token。</p>}
        {available.length>0&&<details className="sf-qb-token-list">
          <summary>查看已保存的 {available.length} 条 Token（仅显示备注）</summary>
          {available.map(item=><div className="sf-qb-token" key={item.id}>
            <div><strong>{item.label}</strong>
              <small>{item.active?"默认 Token":"已加密保存"}</small></div>
            <button className="secondary" type="button" disabled={busy||item.active}
              onClick={()=>void select(item.id)}>{item.active?"当前默认":"设为默认"}</button>
            <button className="secondary" type="button" disabled={busy}
              onClick={()=>void remove(item.id)} aria-label={"删除 Token "+item.label}>删除</button>
          </div>)}
        </details>}
      </div>
      <div className="sf-qb-credentials">
        <label>批量导入 Token（每行一条，同一题库共用此配置）
          <textarea className="sf-qb-secret-lines" rows={5} maxLength={65000}
            autoComplete="off" spellCheck={false} value={tokenLines}
            disabled={busy||loading} placeholder={"第 1 条 Token\n第 2 条 Token\n第 3 条 Token"}
            onChange={e=>setTokenLines(e.target.value)}/>
        </label>
        <button type="button" disabled={busy||loading||!tokenLines.trim()}
          onClick={()=>void add()}>批量导入并加密保存</button>
      </div>
      <p className="sf-qb-hint">自动去除空行和重复值，不覆盖旧 Token；单个题库最多 100 条。导入多条后默认开启轮流使用。每次查询仅发送一条 Token，不会因限流或额度不足自动反复换号。</p>
    </div>
    <section className="sf-qb-manual" aria-label="手动搜题">
      <h4>手动查询参考资料</h4>
      <label>题干
        <textarea rows={2} value={title} disabled={busy}
          placeholder="输入题目，或在课程习题下点击“题库查题”"
          onChange={e=>{setTitle(e.target.value);setAnswer(null);}}/>
      </label>
      <label>选项（每行一项，可选）
        <textarea rows={2} value={options} disabled={busy}
          onChange={e=>{setOptions(e.target.value);setAnswer(null);}}/>
      </label>
      <label>题型
        <select value={questionType} disabled={busy} onChange={e=>setQuestionType(e.target.value)}>
          <option value="">不限</option>
          {["单选","多选","判断","填空"].map(type=><option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <button type="button" disabled={!activeToken||busy||!title.trim()} onClick={()=>void query()}>
        {busy?"查询中…":"查询参考答案"}
      </button>
      <p className="sf-qb-hint">查询会把题干、选项和选中 Token 发送给对应题库，可能消耗额度；不会自动填写或提交作业。</p>
    </section>
    {error&&<p role="alert" className="sf-qb-error">{error}</p>}
    {notice&&<p role="status" className="sf-qb-hint">{notice}</p>}
    {answer?.found&&<div className="sf-qb-answer">
      <strong>{answer.provider_name} · 参考答案（未核验）</strong>
      <pre>{answer.answer}</pre>
      <small>使用 Token：{answer.token_label}{answer.remaining!==null?" · 剩余次数："+answer.remaining:""}</small>
    </div>}
  </section>;
}
