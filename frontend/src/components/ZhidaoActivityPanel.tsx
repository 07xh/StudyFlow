import {useState} from "react";
import {ChevronDown,ChevronUp,History} from "lucide-react";

type Event={id:string;at:string;action:string;result:"success"|"warning"|"info";detail:string};
export function ZhidaoActivityPanel({
  events,expandedByDefault=false,embedded=false
}:{events:Event[];expandedByDefault?:boolean;embedded?:boolean}){
  const [expanded,setExpanded]=useState(expandedByDefault);
  const records=events.length>0
    ?<div className="sf-zd-activity-list">{events.slice(0,20).map(item=><article key={item.id}>
      <span className={"sf-log-indicator "+item.result}/>
      <div><strong>{item.action}</strong><p>{item.detail}</p></div>
      <time dateTime={item.at}>{new Date(item.at).toLocaleTimeString()}</time>
    </article>)}</div>
    :<p className="sf-zd-progress-note">当前暂无运行日志。</p>;
  if(embedded)return <div className="sf-inline-activity">{records}</div>;
  return <section className="settings-card sf-zhidao-activity">
    <div className="section-head">
      <h3><History size={16}/>运行日志</h3>
      <button className="secondary" type="button" aria-expanded={expanded}
        onClick={()=>setExpanded(previous=>!previous)}>
        {expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
        {expanded?"收起运行记录":"展开运行记录"}
      </button>
    </div>
    {expanded&&records}
  </section>;
}
