import {useState} from "react";
import {ChevronDown,ChevronUp,History} from "lucide-react";

type Event={id:string;at:string;action:string;result:"success"|"warning"|"info";detail:string};
export function ZhidaoActivityPanel({events}:{events:Event[]}){
  const [expanded,setExpanded]=useState(false);
  return <section className="settings-card sf-zhidao-activity">
    <div className="section-head">
      <h3><History size={16}/>知到运行记录</h3>
      <button className="secondary" type="button" onClick={()=>setExpanded(value=>!value)}>
        {expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
        {expanded?"收起运行记录":"展开运行记录"}
      </button>
    </div>
    {expanded&&(events.length>0
      ?<div className="sf-zd-activity-list">{events.slice(0,12).map(item=><article key={item.id}>
        <span className={"sf-log-indicator "+item.result}/>
        <div><strong>{item.action}</strong><p>{item.detail}</p></div>
        <time>{new Date(item.at).toLocaleTimeString()}</time>
      </article>)}</div>
      :<p className="sf-zd-progress-note">当前暂无知到任务运行记录。</p>)}
  </section>;
}
