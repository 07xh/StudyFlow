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
  const [busy,setBusy]=useState(desktop);
  const [error,setError]=useState("");
  const [revision,setRevision]=useState(0);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [tasks,setTasks]=useState<UCampusTask[]>([]);
  const [taskBusy,setTaskBusy]=useState(false);
  const [taskError,setTaskError]=useState("");
  const [filter,setFilter]=useState<"all"|"pending"|"completed"|"unknown">("all");
  const [search,setSearch]=useState("");
  const [unitSearch,setUnitSearch]=useState("");

  useEffect(()=>{
    let active=true;
    setUnits([]);setExpanded(null);setTasks([]);setError("");
    if(!desktop){setBusy(false);return()=>{active=false;};}
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
    if(!desktop||!expanded){setTaskBusy(false);return()=>{active=false;};}
    setTaskBusy(true);
    void request<UCampusTask[]>({operation:"ucampus.unit.tasks",course_id:course.course_id,unit_id:expanded})
      .then(list=>{if(!active)return;if(!Array.isArray(list))throw Error("INVALID_IPC_RESPONSE");setTasks(list);})
      .catch(err=>{if(active)setTaskError(friendlyBridgeError(err));})
      .finally(()=>{if(active)setTaskBusy(false);});
    return()=>{active=false;};
  },[course.course_id,desktop,expanded,revision]);

  const unitQuery=unitSearch.trim().toLowerCase();
  const visibleUnits=units.map((unit,index)=>({unit,title:unit.title||"单元 "+(index+1)}))
    .filter(({unit,title})=>title.toLowerCase().includes(unitQuery)||unit.id.toLowerCase().includes(unitQuery));
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
        <p className="sf-muted">{busy?"正在读取单元…":error?"单元读取失败":!desktop?"请在 Windows 桌面版读取":`显示 ${visibleUnits.length} / ${units.length} 个单元`}</p>
      </div>
      <button type="button" className="secondary" disabled={!desktop||busy}
        onClick={()=>{setBusy(true);setExpanded(null);setTasks([]);setError("");setRevision(v=>v+1);}}>{busy?"读取中…":"刷新单元"}</button>
    </div>
    <div className="sf-xxt-filters" role="group" aria-label="单元筛选">
      <label className="sf-xxt-search"><span>搜索单元</span>
        <input type="search" value={unitSearch} onChange={e=>setUnitSearch(e.target.value)} placeholder="单元名称或 ID"/>
      </label>
    </div>
    {busy&&<p role="status">正在读取课程单元…</p>}
    {error&&<p role="alert">{error}</p>}
    {!desktop&&<p role="status" className="sf-muted">请在 Windows 桌面版读取真实课程单元。</p>}
    {desktop&&!busy&&!error&&units.length===0&&<p role="status" className="sf-muted">服务器未返回可识别的课程单元。</p>}
    {!busy&&!error&&units.length>0&&visibleUnits.length===0&&<p role="status" className="sf-muted">没有符合搜索条件的单元。</p>}
    <div className="sf-xxt-chapters">
      {visibleUnits.map(({unit,title})=><article className="sf-xxt-chapter" key={unit.id}>
        <div className="sf-xxt-chapter-head">
          <div className="sf-xxt-chapter-title">
            <strong title={title+" · ID: "+unit.id}>{title}</strong>
          </div>
          <span className="sf-xxt-state unknown">单元状态待核验</span>
          <button type="button" className="secondary"
            aria-expanded={expanded===unit.id} aria-label={title+"："+(expanded===unit.id?"收起任务":"查看任务")}
            disabled={!desktop||busy}
            onClick={()=>{const next=expanded===unit.id?null:unit.id;setTasks([]);setTaskError("");setTaskBusy(next!==null);setFilter("all");setSearch("");setExpanded(next);}}>
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
          {!taskBusy&&!taskError&&tasks.length>0&&<p className="sf-xxt-task-summary">显示 {visible.length} / {tasks.length} 项任务</p>}
          {taskBusy&&<p role="status">正在读取本单元任务…</p>}
          {taskError&&<p role="alert">{taskError}</p>}
          {!taskBusy&&!taskError&&tasks.length===0&&<p className="sf-muted" role="status">本单元未返回任务。</p>}
          <ul className="sf-xxt-task-list">
            {!taskBusy&&!taskError&&visible.map(t=><li className="sf-xxt-task-item" key={t.id}>
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
    <details className="sf-technical-note"><summary>数据口径</summary><p className="sf-muted sf-xxt-evidence-note">当前仅提供课程与任务状态的只读展示。任务“已通过”来自服务器 pass 标记，不代表整门课程完成。</p></details>
  </section>;
}
