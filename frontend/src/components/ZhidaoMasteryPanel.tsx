import {useCallback,useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {friendlyBridgeError,request} from "../bridge";
import "./ZhidaoMasteryPanel.css";

type Settings={
  target:number;max_rounds:number;max_api_calls:number;max_minutes:number;
  auto_next:boolean;next_scope:"course"|"chapter";browser:"msedge"|"chrome";
  use_ai:boolean;has_api_key:boolean;has_saved_entry:boolean;
};
type Detail={
  state?:string;phase?:string;message?:string;course?:string;chapter?:string;knowledge?:string;
  mastery?:number|null;round?:number;points_completed?:number;points_skipped?:number;
  bank_hit?:number;trial_count?:number;ai_count?:number;api_calls?:number;question?:string;logs?:string[];
};
type Status={running:boolean;state:string;detail:Detail};
const EMPTY:Status={running:false,state:"idle",detail:{}};

export function ZhidaoMasteryPanel({desktop,courseTitle}:{desktop:boolean;courseTitle:string}){
  const [settings,setSettings]=useState<Settings|null>(null);
  const [entryUrl,setEntryUrl]=useState("");
  const [apiKey,setApiKey]=useState("");
  const [status,setStatus]=useState<Status>(EMPTY);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const refresh=useCallback(async()=>{
    if(!desktop)return;
    try{setStatus(await invoke<Status>("zhidao_mastery_status"));}
    catch{/* Old builds without this command remain read-only. */}
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

  const update=(changes:Partial<Settings>)=>setSettings(prev=>prev?{...prev,...changes}:prev);
  const save=async():Promise<Settings>=>{
    if(!settings)throw new Error("请先读取设置");
    const result=await request<Settings>({operation:"zhidao.mastery.settings.save",settings:{
      target:settings.target,max_rounds:settings.max_rounds,
      max_api_calls:settings.max_api_calls,max_minutes:settings.max_minutes,
      auto_next:settings.auto_next,next_scope:settings.next_scope,browser:settings.browser,
      use_ai:settings.use_ai,
      ...(apiKey.trim()?{api_key:apiKey.trim()}:{}),
      ...(entryUrl.trim()?{entry_url:entryUrl.trim()}:{}),
    }});
    setSettings(result);setEntryUrl("");setApiKey("");
    return result;
  };
  const action=async(kind:"save"|"login"|"run"|"pause"|"stop")=>{
    if(!desktop||busy||!settings)return;
    setBusy(true);setMessage("");
    try{
      if(kind==="save"){await save();setMessage("设置已保存。");return;}
      if(kind==="login"||kind==="run"){
        const result=await save();
        if(kind==="run"&&result.use_ai&&!result.has_api_key){setMessage("请先配置 DeepSeek API Key，或关闭 AI 模式。");return;}
        if(kind==="run"&&!result.has_saved_entry){
          setMessage("请先点击「设置起点」，在官方浏览器中打开一道掌握度习题。");
          return;
        }
        setStatus(await invoke<Status>("zhidao_mastery_start",{mode:kind}));
        setMessage(kind==="login"?"请在打开的官方浏览器完成登录并进入掌握度习题页；识别成功后自动保存起点。":"已启动后台练习。");
      }else if(kind==="stop"){
        setStatus(await invoke<Status>("zhidao_mastery_stop"));
      }else{
        setStatus(await invoke<Status>("zhidao_mastery_pause",{paused:status.detail.phase!=="已暂停"}));
      }
    }catch(error){
      const raw=String(error instanceof Error?error.message:error);
      setMessage(raw.startsWith("MASTERY_")?raw:friendlyBridgeError(error));
    }finally{
      setBusy(false);
      void refresh();
      if(kind==="login"){
        // The worker writes the saved entry after the official page is selected.
        void request<Settings>({operation:"zhidao.mastery.settings.get"}).then(setSettings).catch(()=>{});
      }
    }
  };
  const d=status.detail;
  const running=status.running;
  const metrics:ReadonlyArray<[string,string|number]>=[
    ["掌握度",typeof d.mastery==="number"?d.mastery+"%":"—"],
    ["当前轮次",d.round||0],
    ["完成知识点",d.points_completed||0],
    ["已跳过",d.points_skipped||0],
    ["题库命中",d.bank_hit||0],
    ["本地试答",d.trial_count||0],
    ["AI 解题",d.ai_count||0],
    ["API 请求",d.api_calls||0],
  ];
  return <section className="sf-mastery-panel" aria-label="知到掌握度">
    <header className="sf-mastery-heading">
      <div>
        <h3>掌握度练习</h3>
        <p>题库优先，未命中的题目可选 DeepSeek AI 或本地试答；提交后读取平台解析，持续修正本地题库。</p>
      </div>
      <span className="sf-mastery-state">{running?(d.phase||"运行中"):status.state==="completed"?"已完成":status.state==="ready"?"起点就绪":status.state==="error"?"需要处理":"未运行"}</span>
    </header>
    {!desktop?<p>请在 Windows 桌面版使用。</p>:<>
      <div className="sf-mastery-settings">
        <label>目标掌握度<input type="number" min={1} max={100} value={settings?.target??100}
          disabled={!settings||running} onChange={e=>update({target:Number(e.target.value)})}/></label>
        <label>每知识点轮次上限<input type="number" min={1} max={30} value={settings?.max_rounds??20}
          disabled={!settings||running} onChange={e=>update({max_rounds:Number(e.target.value)})}/></label>
        <label>AI 请求上限<input type="number" min={1} max={1000} value={settings?.max_api_calls??100}
          disabled={!settings||running} onChange={e=>update({max_api_calls:Number(e.target.value)})}/></label>
        <label>运行时长上限（分钟）<input type="number" min={1} max={240} value={settings?.max_minutes??60}
          disabled={!settings||running} onChange={e=>update({max_minutes:Number(e.target.value)})}/></label>
        <label>浏览器<select disabled={!settings||running} value={settings?.browser??"msedge"}
          onChange={e=>update({browser:e.target.value as Settings["browser"]})}>
          <option value="msedge">Edge</option><option value="chrome">Chrome</option></select></label>
        <label>处理范围<select disabled={!settings||running} value={settings?.next_scope??"course"}
          onChange={e=>update({next_scope:e.target.value as Settings["next_scope"]})}>
          <option value="course">本课程后续知识点</option><option value="chapter">仅当前章节</option></select></label>
        <label className="sf-mastery-check"><input type="checkbox" disabled={!settings||running}
          checked={settings?.use_ai??true} onChange={e=>update({use_ai:e.target.checked})}/>
          启用 DeepSeek AI 答题（未命中题库时调用）</label>
        <label className="sf-mastery-wide">DeepSeek API Key（{settings?.has_api_key?"已加密保存":"未设置"}）
          <input type="password" autoComplete="off" value={apiKey} disabled={!settings||running||!settings.use_ai}
            placeholder={settings?.has_api_key?"留空保持原密钥":"输入自己的 DeepSeek Key"}
            onChange={e=>setApiKey(e.target.value)}/></label>
        <label className="sf-mastery-wide">练习入口链接（可选）
          <input type="url" disabled={!settings||running} value={entryUrl}
            placeholder={settings?.has_saved_entry?"已保存起点；留空继续使用":"也可以先点击「设置起点」在官方浏览器选择"}
            onChange={e=>setEntryUrl(e.target.value)}/></label>
        <label className="sf-mastery-check"><input type="checkbox" disabled={!settings||running}
          checked={settings?.auto_next??true} onChange={e=>update({auto_next:e.target.checked})}/>
          达标后继续后续知识点</label>
      </div>
      <div className="sf-mastery-actions">
        <button className="secondary" type="button" disabled={!settings||busy||running} onClick={()=>void action("login")}>设置起点／首次登录</button>
        <button className="secondary" type="button" disabled={!settings||busy||running} onClick={()=>void action("save")}>保存设置</button>
        <button type="button" disabled={!settings||busy||running} onClick={()=>void action("run")}>开始后台练习</button>
        <button className="secondary" type="button" disabled={busy||!running} onClick={()=>void action("pause")}>{d.phase==="已暂停"?"继续":"暂停"}</button>
        <button className="secondary" type="button" disabled={busy||!running} onClick={()=>void action("stop")}>停止</button>
      </div>
      <div className="sf-mastery-metrics">{metrics.map(([label,value])=>
        <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
      <p className="sf-mastery-desc" role="status">{message||d.message||"首次用官方浏览器登录并选择起点；后续在后台使用已保存的练习页。"}</p>
      {d.course&&<p className="sf-mastery-desc">当前：{d.course} / {d.chapter} / {d.knowledge}
        {d.course!==courseTitle?"（核对当前任务是否属于所选课程）":""}</p>}
      {d.question&&<p className="sf-mastery-desc">当前题目：{d.question}</p>}
      {Array.isArray(d.logs)&&d.logs.length>0&&<details><summary>运行日志</summary>
        <div className="sf-mastery-logs">{d.logs.map((line,i)=><p key={i}>{line}</p>)}</div></details>}
      <p className="sf-mastery-footnote">100% 是目标，不保证所有知识点都达成；平台解析和服务器结果为准。启用 DeepSeek 需要自己的 Key，API 请求可能产生费用。本模块与 ZHS 视频任务相互独立。</p>
    </>}
  </section>;
}
