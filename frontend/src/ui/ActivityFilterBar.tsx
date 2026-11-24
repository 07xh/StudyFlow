import {activityResultLabels,type ActivityEntry,type ActivityFilter} from "../activity";
import {platformNames} from "../presentation";

export function ActivityFilterBar({events,filter,onChange,visibleCount}:{events:ActivityEntry[];filter:ActivityFilter;onChange:(filter:ActivityFilter)=>void;visibleCount:number}){
 const platforms=Array.from(new Set([...Object.values(platformNames),...events.map(event=>event.platform)]));
 const active=filter.platform!=="all"||filter.result!=="all"||filter.query.trim()!=="";
 return <div className="sf-activity-toolbar" role="group" aria-label="记录筛选">
   <label><span>平台</span><select value={filter.platform} onChange={e=>onChange({...filter,platform:e.target.value})}>
     <option value="all">全部平台</option>
     {platforms.map(name=><option key={name} value={name}>{name}</option>)}
   </select></label>
   <label><span>结果</span><select value={filter.result} onChange={e=>onChange({...filter,result:e.target.value as ActivityFilter["result"]})}>
     <option value="all">全部状态</option>
     {Object.entries(activityResultLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <label className="sf-activity-search"><span>搜索记录</span><input type="search" value={filter.query} placeholder="操作、详情或课程 ID" onChange={e=>onChange({...filter,query:e.target.value})}/></label>
   <span className="sf-muted" role="status">显示 {visibleCount} / {events.length} 条</span>
   {active&&<button type="button" className="secondary" onClick={()=>onChange({platform:"all",result:"all",query:""})}>清除筛选</button>}
 </div>;
}
