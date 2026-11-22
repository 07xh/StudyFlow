import {useCallback,useEffect,useState} from "react";
import {
  friendlyBridgeError,yanxiClearToken,yanxiQuery,yanxiSaveToken,yanxiStatus,
  type MasteryQuestion,type YanxiLookupResult,
} from "../bridge";
import "./YanxiQuestionBankPanel.css";

const LABELS:Record<number,string>={1:"单选",2:"多选",3:"填空",14:"判断"};

/** Optional independent reference search; never writes official ZHS answer cards. */
export function YanxiQuestionBankPanel({desktop,questions=[]}:{
  desktop:boolean;questions?:MasteryQuestion[];
}){
  const [configured,setConfigured]=useState(false);
  const [checking,setChecking]=useState(true);
  const [token,setToken]=useState("");
  const [title,setTitle]=useState("");
  const [options,setOptions]=useState("");
  const [questionType,setQuestionType]=useState("");
  const [selected,setSelected]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [result,setResult]=useState<YanxiLookupResult|null>(null);

  useEffect(()=>{
    if(!desktop)return;
    let mounted=true;
    setChecking(true);
    void yanxiStatus().then(data=>{if(mounted)setConfigured(data.configured);})
      .catch(cause=>{if(mounted)setError(friendlyBridgeError(cause));})
      .finally(()=>{if(mounted)setChecking(false);});
    return ()=>{mounted=false;};
  },[desktop]);

  const save=useCallback(async()=>{
    if(busy||!token.trim())return;
    setBusy(true);setError("");setMessage("");
    try{
      const response=await yanxiSaveToken(token.trim());
      setConfigured(response.configured);setToken("");
      setMessage("Token 已加密保存在本机。可通过查询题目验证是否可用（可能消耗额度）。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  },[busy,token]);

  const clear=useCallback(async()=>{
    if(busy)return;
    setBusy(true);setError("");setMessage("");
    try{
      await yanxiClearToken();
      setConfigured(false);setToken("");setResult(null);
      setMessage("本机言溪 Token 已清除。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  },[busy]);

  const search=useCallback(async()=>{
    if(busy||!configured||!title.trim())return;
    setBusy(true);setError("");setMessage("");setResult(null);
    try{
      const response=await yanxiQuery(title.trim(),options.trim(),questionType);
      setResult(response);
      setMessage(response.found?"言溪已返回参考答案，请自行核对题干和选项。":"言溪未找到可用答案。");
    }catch(cause){setError(friendlyBridgeError(cause));}
    finally{setBusy(false);}
  },[busy,configured,title,options,questionType]);

  const selectQuestion=(id:string)=>{
    setSelected(id);
    const question=questions.find(item=>String(item.question_id)===id);
    if(!question)return;
    setTitle(question.content);
    setOptions(question.options.map((option,index)=>`${String.fromCharCode(65+index)}. ${option.content}`).join("\n"));
    setQuestionType(LABELS[question.question_type]||"");
    setResult(null);setMessage("");
  };

  if(!desktop)return null;
  return <details className="sf-yanxi-panel" aria-label="言溪题库搜题">
    <summary>言溪题库 · 本地 Token 搜题 {configured?"（已配置）":"（未配置）"}</summary>
    <div className="sf-yanxi-content">
      <p className="sf-yanxi-note">
        Windows EXE 本机直连言溪，不经过 Cloudflare。查询会向言溪发送题干、选项和本人的 Token；
        可能消耗题库额度。参考答案未经知到官方验证，也不会自动保存或提交练习。
      </p>
      <div className="sf-yanxi-token-row">
        <label className="sf-yanxi-grow">言溪 Token（仅在保存时上传到本机 Sidecar）
          <input type="password" value={token} autoComplete="off" disabled={busy||checking}
            placeholder={configured?"已加密保存；输入新 Token 可替换":"从言溪用户控制台复制 Token"}
            onChange={event=>setToken(event.target.value)}/>
        </label>
        <button type="button" disabled={busy||checking||!token.trim()} onClick={()=>void save()}>保存 Token</button>
        <button type="button" className="secondary" disabled={busy||checking||!configured} onClick={()=>void clear()}>清除</button>
      </div>
      <div className="sf-yanxi-fields">
        {questions.length>0&&<label>选择当前练习题
          <select value={selected} disabled={busy} onChange={event=>selectQuestion(event.target.value)}>
            <option value="">手动输入题目</option>
            {questions.map((question,index)=><option key={question.question_id} value={String(question.question_id)}>
              第 {index+1} 题 · {question.content.slice(0,48)}
            </option>)}
          </select>
        </label>}
        <label>题干
          <textarea rows={2} disabled={busy} value={title}
            placeholder="输入需要查询的练习题题干"
            onChange={event=>{setTitle(event.target.value);setSelected("");setResult(null);}}/>
        </label>
        <label>选项（可选，每行一个）
          <textarea rows={2} disabled={busy} value={options}
            onChange={event=>{setOptions(event.target.value);setSelected("");setResult(null);}}/>
        </label>
        <label>题型（可选）
          <select disabled={busy} value={questionType} onChange={event=>setQuestionType(event.target.value)}>
            <option value="">不限</option>
            {Object.values(LABELS).map(label=><option key={label} value={label}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="sf-yanxi-actions">
        <button type="button" disabled={busy||checking||!configured||!title.trim()} onClick={()=>void search()}>
          {busy?"处理中…":"查询参考答案 / 验证连接"}
        </button>
        <span className="sf-yanxi-note">{checking?"读取本地配置…":configured?"已配置本地 Token":"请先保存自己的 Token"}</span>
      </div>
      {error&&<p role="alert" className="sf-yanxi-error">{error}</p>}
      {message&&<p role="status" className="sf-yanxi-note">{message}</p>}
      {result?.found&&<div className="sf-yanxi-result">
        <strong>言溪参考答案（未验证）</strong>
        <pre>{result.answer}</pre>
        {result.remaining!==null&&<small>服务端报告剩余次数：{result.remaining}</small>}
      </div>}
    </div>
  </details>;
}
