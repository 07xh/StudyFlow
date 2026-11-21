import {useCallback,useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {friendlyBridgeError,request} from "../bridge";
import "./ZhidaoMasteryPanel.css";

type Settings={
  target:number;max_rounds:number;max_api_calls:number;max_minutes:number;
  auto_next:boolean;next_scope:"course"|"chapter";browser:"msedge"|"chrome";
};
type Detail={
  phase?:string;message?:string;course?:string;chapter?:string;knowledge?:string;
  mastery?:number|null;round?:number;points_completed?:number;
  points_skipped?:number;bank_hit?:number;trial_count?:number;
  api_calls?:number;question?:string;logs?:string[];
};
type Status={running:boolean;state:string;detail:Detail};
const EMPTY:Status={running:false,state:"idle",detail:{}};

export function ZhidaoMasteryPanel({desktop,courseTitle,courseId}:{
  desktop:boolean;courseTitle:string;courseId:string;
}){
  const [settings,setSettings]=useState<Settings|null>(null);
  const [status,setStatus]=useState<Status>(EMPTY);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const refresh=useCallback(async()=>{
    if(!desktop)return;
    try{setStatus(await invoke<Status>("zhidao_mastery_status"));}
    catch{/* On an older build, the controls remain unavailable. */}
  },[desktop]);
  useEffect(()=>{
    if(!desktop)return;
    let active=true;
    void request<Settings>({operation:"zhidao.mastery.settings.get"})
      .then(value=>{if(active)setSettings(value);})
      .catch(error=>{if(active)setMessage(friendlyBridgeError(error));});
    void refresh();
    const id=window.setInterval(()=>{void refresh();},2000);
    return ()=>{active=false;window.clearInterval(id);};
  },[desktop,refresh]);

  const update=(change:Partial<Settings>)=>setSettings(prev=>prev?{...prev,...change}:prev);
  const action=async(kind:"save"|"start"|"pause"|"stop")=>{
    if(!desktop||busy||!settings)return;
    setBusy(true);setMessage("");
    try{
      if(kind==="save"||kind==="start"){
        const updated=await request<Settings>({operation:"zhidao.mastery.settings.save",settings:{
          target:settings.target,max_rounds:settings.max_rounds,
          max_api_calls:settings.max_api_calls,max_minutes:settings.max_minutes,
          auto_next:settings.auto_next,next_scope:settings.next_scope
        }});
        setSettings(updated);
        if(kind==="save"){setMessage("掌握度设置已保存。");return;}
      }
      const command=kind==="start"?"zhidao_mastery_start":
        kind==="pause"?"zhidao_mastery_pause":"zhidao_mastery_stop";
      const payload=kind==="start"?{courseKey:courseId}:
        kind==="pause"?{paused:status.detail.phase!=="已暂停"}:{};
      setStatus(await invoke<Status>(command,payload));
      if(kind==="start")setMessage("已启动纯 HTTP 后台任务，使用知到账号现有登录态。");
    }catch(error){
      const raw=String(error instanceof Error?error.message:error);
      setMessage(raw.startsWith("MASTERY_")?raw:friendlyBridgeError(error));
    }finally{setBusy(false);void refresh();}
  };
  const d=status.detail, running=status.running;
  const metrics:ReadonlyArray<[string,number|string]>=[
    ["掌握度",typeof d.mastery==="number"?d.mastery+"%":"—"],
    ["当前轮次",d.round||0],
    ["已处理知识点",d.points_completed||0],
    ["题库命中",d.bank_hit||0],
    ["试答次数",d.trial_count||0],
    ["已跳过",d.points_skipped||0]
  ];
  return <section className="sf-mastery-panel" aria-label="知到掌握度">
    <header className="sf-mastery-heading">
      <div>
        <h3>掌握度 · 纯接口模式</h3>
        <p>复用知到已登录会话，通过 HTTP 读取题目与答题卡、保存答案并核对服务器掌握度。不使用浏览器或 AI。</p>
      </div>
      <span className="sf-mastery-state">{running?(d.phase||"运行中"):status.state==="completed"?"任务结束":status.state==="error"?"需要处理":"未运行"}</span>
    </header>
    {!desktop?<p>请在 Windows 桌面版使用。</p>:<>
      <div className="sf-mastery-settings">
        <label>目标掌握度<input type="number" min={1} max={100}
          disabled={!settings||running} value={settings?.target??100}
          onChange={e=>update({target:Number(e.target.value)})}/></label>
        <label>单知识点最多轮次<input type="number" min={1} max={30}
          disabled={!settings||running} value={settings?.max_rounds??20}
          onChange={e=>update({max_rounds:Number(e.target.value)})}/></label>
        <label>运行时间上限（分钟）<input type="number" min={1} max={240}
          disabled={!settings||running} value={settings?.max_minutes??60}
          onChange={e=>update({max_minutes:Number(e.target.value)})}/></label>
        <label className="sf-mastery-check">
          <input type="checkbox" disabled={!settings||running}
            checked={settings?.auto_next??true} onChange={e=>update({auto_next:e.target.checked})}/>
          达标后处理后续知识点
        </label>
      </div>
      <div className="sf-mastery-actions">
        <button className="secondary" type="button" disabled={!settings||busy||running}
          onClick={()=>void action("save")}>保存设置</button>
        <button type="button" disabled={!settings||busy||running}
          onClick={()=>void action("start")}>开始后台掌握度</button>
        <button className="secondary" type="button" disabled={busy||!running}
          onClick={()=>void action("pause")}>{d.phase==="已暂停"?"继续":"暂停"}</button>
        <button className="secondary" type="button" disabled={busy||!running}
          onClick={()=>void action("stop")}>停止</button>
      </div>
      <div className="sf-mastery-metrics">{metrics.map(([label,value])=>
        <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
      <p className="sf-mastery-desc" role="status">{message||d.message||"使用学序知到的现有登录态，无需额外登录或配置浏览器。"}</p>
      {d.course&&<p className="sf-mastery-desc">运行课程：{d.course} / {d.chapter} / {d.knowledge}{d.course!==courseTitle?"（请核对账号的课程名称）":""}</p>}
      {d.question&&<p className="sf-mastery-desc">当前题目：{d.question}</p>}
      {Array.isArray(d.logs)&&d.logs.length>0&&<details><summary>任务日志</summary>
        <div className="sf-mastery-logs">{d.logs.map((line,i)=><p key={i}>{line}</p>)}</div>
      </details>}
      <p className="sf-mastery-footnote">目标 100% 不等于保证满分。提交需要平台允许的正式接口和有效会话，只有服务器回读确认后才更新掌握度。该任务不修改原 ZHS 心跳。</p>
    </>}
  </section>;
}
