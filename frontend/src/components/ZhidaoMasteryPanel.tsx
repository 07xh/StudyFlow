import {useCallback,useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {friendlyBridgeError,request} from "../bridge";
import "./ZhidaoMasteryPanel.css";

type Settings={
  target:number;max_rounds:number;max_api_calls:number;max_minutes:number;
  auto_next:boolean;next_scope:"course"|"chapter";browser:"msedge"|"chrome";
  has_api_key:boolean;has_saved_entry:boolean;
};
type Detail={
  phase?:string;message?:string;course?:string;chapter?:string;knowledge?:string;
  mastery?:number|null;round?:number;points_completed?:number;
  points_skipped?:number;bank_hit?:number;ai_count?:number;
  api_calls?:number;question?:string;logs?:string[];
};
type Status={running:boolean;state:string;detail:Detail};
const EMPTY:Status={running:false,state:"idle",detail:{}};

export function ZhidaoMasteryPanel({desktop,courseTitle}:{desktop:boolean;courseTitle:string}){
  const [settings,setSettings]=useState<Settings|null>(null);
  const [apiKey,setApiKey]=useState("");
  const [entryUrl,setEntryUrl]=useState("");
  const [status,setStatus]=useState<Status>(EMPTY);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  const refresh=useCallback(async()=>{
    if(!desktop)return;
    try{setStatus(await invoke<Status>("zhidao_mastery_status"));}
    catch{/* On an older desktop build the panel still shows the settings error. */}
  },[desktop]);

  useEffect(()=>{
    if(!desktop)return;
    let live=true;
    void request<Settings>({operation:"zhidao.mastery.settings.get"})
      .then(value=>{if(live)setSettings(value);})
      .catch(error=>{if(live)setMessage(friendlyBridgeError(error));});
    void refresh();
    const timer=window.setInterval(()=>{void refresh();},2000);
    return ()=>{live=false;window.clearInterval(timer);};
  },[desktop,refresh]);

  const update=(change:Partial<Settings>)=>setSettings(value=>value?{...value,...change}:value);
  const call=async(action:"save"|"start"|"stop"|"pause")=>{
    if(busy||!desktop||!settings)return;
    setBusy(true);setMessage("");
    try{
      if(action==="save"||action==="start"){
        const values={
          target:settings.target,max_rounds:settings.max_rounds,
          max_api_calls:settings.max_api_calls,max_minutes:settings.max_minutes,
          auto_next:settings.auto_next,next_scope:settings.next_scope,
          browser:settings.browser,
          ...(apiKey.trim()?{api_key:apiKey.trim()}:{}),
          ...(entryUrl.trim()?{entry_url:entryUrl.trim()}:{}),
        };
        const result=await request<Settings>({operation:"zhidao.mastery.settings.save",settings:values});
        setSettings(result);setApiKey("");setEntryUrl("");
        if(action==="save"){setMessage("设置已保存到本机。");return;}
        if(!result.has_api_key){setMessage("先填写 DeepSeek API Key。");return;}
      }
      const name=action==="start"?"zhidao_mastery_start":
        action==="stop"?"zhidao_mastery_stop":"zhidao_mastery_pause";
      const next=await invoke<Status>(name,action==="pause"?{paused:status.detail.phase!=="已暂停"}:{});
      setStatus(next);
    }catch(error){
      const code=String(error instanceof Error?error.message:error);
      setMessage(code.startsWith("MASTERY_")?code:friendlyBridgeError(error));
    }finally{setBusy(false);}
  };

  const d=status.detail;
  const running=status.running;
  const values:ReadonlyArray<[string,string|number]>=[
    ["掌握度",typeof d.mastery==="number"?d.mastery+"%":"—"],
    ["当前轮次",d.round||0],
    ["已处理知识点",d.points_completed||0],
    ["题库匹配",d.bank_hit||0],
    ["AI 解题",d.ai_count||0],
    ["API 请求",d.api_calls||0]
  ];
  return <section className="sf-mastery-panel" aria-label="知到掌握度">
    <header className="sf-mastery-heading">
      <div><h3>掌握度练习</h3><p>复用 ZhiHuiShuHelper：题库优先、DeepSeek 补题、读取平台解析与掌握度结果。</p></div>
      <span className="sf-mastery-state">{running?(d.phase||"运行中"):status.state==="completed"?"已完成":"未运行"}</span>
    </header>
    {!desktop?<p>请在 Windows 桌面版使用掌握度模块。</p>:<>
      <div className="sf-mastery-settings">
        <label>目标掌握度<input type="number" min={1} max={100} value={settings?.target??100}
          disabled={!settings||running} onChange={e=>update({target:Number(e.target.value)})}/></label>
        <label>每知识点轮次上限<input type="number" min={1} max={30} value={settings?.max_rounds??20}
          disabled={!settings||running} onChange={e=>update({max_rounds:Number(e.target.value)})}/></label>
        <label>AI 请求上限<input type="number" min={1} max={1000} value={settings?.max_api_calls??100}
          disabled={!settings||running} onChange={e=>update({max_api_calls:Number(e.target.value)})}/></label>
        <label>运行分钟上限<input type="number" min={1} max={240} value={settings?.max_minutes??60}
          disabled={!settings||running} onChange={e=>update({max_minutes:Number(e.target.value)})}/></label>
        <label>浏览器<select disabled={!settings||running} value={settings?.browser??"msedge"}
          onChange={e=>update({browser:e.target.value as Settings["browser"]})}>
          <option value="msedge">Edge</option><option value="chrome">Chrome</option></select></label>
        <label>后续范围<select disabled={!settings||running} value={settings?.next_scope??"course"}
          onChange={e=>update({next_scope:e.target.value as Settings["next_scope"]})}>
          <option value="course">本课程后续知识点</option><option value="chapter">仅当前章节</option></select></label>
        <label className="sf-mastery-wide">DeepSeek API Key（{settings?.has_api_key?"本机已保存":"尚未设置"}）
          <input type="password" autoComplete="off" disabled={!settings||running} value={apiKey}
            placeholder={settings?.has_api_key?"保持空白以继续使用已保存的 Key":"填写你自己的 API Key"}
            onChange={e=>setApiKey(e.target.value)}/></label>
        <label className="sf-mastery-wide">掌握度题目入口链接（可选）
          <input type="url" disabled={!settings||running} value={entryUrl}
            placeholder={settings?.has_saved_entry?"已保存入口；留空继续使用":"首次可在自动打开的官方 Edge 中登录并选择知识点"}
            onChange={e=>setEntryUrl(e.target.value)}/></label>
        <label className="sf-mastery-check"><input type="checkbox" disabled={!settings||running}
          checked={settings?.auto_next??true} onChange={e=>update({auto_next:e.target.checked})}/>
          达标后继续下一个知识点</label>
      </div>
      <div className="sf-mastery-actions">
        <button className="secondary" type="button" disabled={!settings||busy||running} onClick={()=>void call("save")}>保存设置</button>
        <button type="button" disabled={!settings||busy||running} onClick={()=>void call("start")}>开始掌握度</button>
        <button className="secondary" type="button" disabled={busy||!running}
          onClick={()=>void call("pause")}>{d.phase==="已暂停"?"继续":"暂停"}</button>
        <button className="secondary" type="button" disabled={busy||!running}
          onClick={()=>void call("stop")}>停止</button>
      </div>
      <div className="sf-mastery-metrics">{values.map(([label,value])=>
        <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
      <p className="sf-mastery-desc" role="status">{message||d.message||"第一次使用需要在官方浏览器完成登录，之后可后台静默运行。"}</p>
      {d.course&&<p className="sf-mastery-desc">当前运行：{d.course} / {d.chapter} / {d.knowledge}
        {d.course!==courseTitle?"（请核对是否为所选课程）":""}</p>}
      {d.question&&<p className="sf-mastery-desc">当前题目：{d.question}</p>}
      {Array.isArray(d.logs)&&d.logs.length>0&&<details><summary>运行日志</summary>
        <div className="sf-mastery-logs">{d.logs.map((line,i)=><p key={i}>{line}</p>)}</div></details>}
      <p className="sf-mastery-footnote">100% 为目标，不代表保证正确率；按平台实际结果判断。AI 请求可能产生费用。该模块独立于 ZHS 视频任务。</p>
    </>}
  </section>;
}
