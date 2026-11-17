import type {ActivityEntry} from "../activity";

/** Course-scoped logs are always presented inline in the existing dialog.
 * The former independent accordion had no caller and duplicated dialog state.
 */
export function ZhidaoActivityPanel({events}:{events:ActivityEntry[]}){
  const records=events.length>0
    ?<div className="sf-zd-activity-list">{events.slice(0,20).map(item=><article key={item.id}>
      <span className={"sf-log-indicator "+item.result}/>
      <div><strong>{item.action}</strong><p>{item.detail}</p></div>
      <time dateTime={item.at}>{new Date(item.at).toLocaleTimeString()}</time>
    </article>)}</div>
    :<p className="sf-zd-progress-note">当前暂无运行日志。</p>;
  return <div className="sf-inline-activity">{records}</div>;
}
