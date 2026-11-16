import {useEffect,useState} from "react";
import type {Course} from "../types";
import {friendlyBridgeError,request,type UCampusTask,type UCampusUnit} from "../bridge";
import "./XuexitongPanels.css";

/** Read-only U校园 task directory in the shared StudyFlow course workspace.
 * Uses only a server response; it never synthesizes completion or a progress bar.
 */
const typeLabels:Record<string,string>={
  video:"视频",audio:"音频",text:"阅读",task:"练习",document:"资料",unknown:"其他"
};
function labelType(type:string){return typeLabels[type]??type;}
export function UCampusCourseDetailPanel({course,desktop}:{course:Course;desktop:boolean}){
  const [units,setUnits]=useState<UCampusUnit[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [tasks,setTasks]=useState<UCampusTask[]>([]);
  const [taskBusy,setTaskBusy]=useState(false);
  const [taskError,setTaskError]=useState("");
  const [filter,setFilter]=useState<"all"|"pending"|"completed"|"unknown">("all");
  const [search,setSearch]=useState("");

  useEffect(()=>{
    let active=true;
    setUnits([]);setExpanded(null);setTasks([]);setError("");
    if(!desktop)return()=>{active=false;};
    setBusy(true);
    void request<UCampusUnit[]>({operation:"ucampus.units.list",course_id:course.course_id})
      .then(list=>{if(!active)return;if(!Array.isArray(list))throw Error("INVALID_IPC_RESPONSE");setUnits(list);})
      .catch(err=>{if(active)setError(friendlyBridgeError(err));})
      .finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[course.course_id,desktop,revision]);

  useEffect(()=>{
    let active=true;
    setTasks([]);setTaskError("");
    if(!desktop||!expanded)return()=>{active=false;};
    setTaskBusy(true);
    void request<UCampusTask[]>({operation:"ucampus.unit.tasks",course_id:course.course_id,unit_id:expanded})
      .then(list=>{if(!active)return;if(!Array.isArray(list))throw Error("INVALID_IPC_RESPONSE");setTasks(list);})
      .catch(err=>{if(active)setTaskError(friendlyBridgeError(err));})
      .finally(()=>{if(active)setTaskBusy(false);});
    return()=>{active=false;};
  },[course.course_id,desktop,expanded,revision]);

  const normalizedSearch=search.trim().toLowerCase();
  const visible=tasks.filter(t=>(filter==="all"||
    (filter==="completed"&&t.completed===true)||
    (filter==="pending"&&t.completed===false)||
    (filter==="unknown"&&t.completed===null))&&
    (t.id.toLowerCase().includes(normalizedSearch)||
     (t.title||"").toLowerCase().includes(normalizedSearch)||
     labelType(t.type).toLowerCase().includes(normalizedSearch)));

  return <section aria-label="U校园真实单元与任务" className="sf-xxt-catalog">
    <div className="section-head sf-xxt-heading">
      <div>
        <h3>单元与任务</h3>
        <p className="sf-muted">已读取 {units.length} 个单元 · 单元完成率尚未核验</p>
      </div>
      <button type="button" className="secondary" disabled={!desktop||busy}
        onClick={()=>{setRevision(v=>v+1);}}>刷新</button>
    </div>
    <p className="sf-muted">数据来自 U校园AI 课程进度接口；任务的“已通过”仅指服务器返回的 pass 标记，不代表整门课程完成。</p>
    {busy&&<p role="status">正在读取课程单元…</p>}
    {error&&<p role="alert">{error}</p>}
    {!busy&&!error&&units.length===0&&<p role="status" className="sf-muted">服务器未返回可识别的课程单元。</p>}
    <div className="sf-xxt-chapters">
      {units.map((unit,index)=><article className="sf-xxt-chapter" key={unit.id}>
        <div className="sf-xxt-chapter-head">
          <div className="sf-xxt-chapter-title">
            <strong>{unit.title||"单元 "+(index+1)}</strong>
            <span className="sf-xxt-chapter-id">#{unit.id}</span>
          </div>
          <span className="sf-xxt-state unknown">单元状态待核验</span>
          <button type="button" className="secondary"
            aria-expanded={expanded===unit.id}
            disabled={!desktop||busy}
            onClick={()=>{setFilter("all");setSearch("");setExpanded(v=>v===unit.id?null:unit.id);}}>
            {expanded===unit.id?"收起":"查看任务"}
          </button>
        </div>
        {expanded===unit.id&&<div className="sf-xxt-task-panel">
          <div className="sf-xxt-filters sf-xxt-task-filters">
            <label className="sf-xxt-search"><span>搜索任务</span>
              <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="名称、ID 或类型"/>
            </label>
            <label className="sf-xxt-select"><span>服务器状态</span>
              <select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>
                <option value="all">全部</option>
                <option value="pending">未通过</option>
                <option value="completed">已通过</option>
                <option value="unknown">待核验</option>
              </select>
            </label>
          </div>
          <p className="sf-muted">{unit.title||"单元 "+(index+1)} · 任务按服务器返回的资源标识展示</p>
          {taskBusy&&<p role="status">正在读取本单元任务…</p>}
          {taskError&&<p role="alert">{taskError}</p>}
          {!taskBusy&&!taskError&&tasks.length===0&&<p className="sf-muted" role="status">本单元未返回任务。</p>}
          <ul className="sf-xxt-task-list">
            {!taskBusy&&visible.map(t=><li className="sf-xxt-task-item" key={t.id}>
              <span className="sf-xxt-task-type">{labelType(t.type)}</span>
              <strong>{t.title||t.id}</strong>
              <span className={"sf-xxt-state "+(t.completed===true?"completed":t.completed===false?"pending":"unknown")}>
                {t.completed===true?"已通过":t.completed===false?"未通过":"待核验"}
              </span>
              <small>{t.required===true?"必修":t.required===false?"非必修":"必修状态未知"}</small>
            </li>)}
          </ul>
          {!taskBusy&&!taskError&&tasks.length>0&&visible.length===0&&
            <p className="sf-muted" role="status">没有符合筛选条件的任务。</p>}
        </div>}
      </article>)}
    </div>
    <p className="sf-muted sf-xxt-evidence-note">
      当前仅支持课程与任务状态只读核验。学习内容、媒体播放与本地心跳发送仍待真实协议验收。
    </p>
  </section>;
}
