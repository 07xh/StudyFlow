import {Activity,History,Search} from "lucide-react";
import {executionEvents,filterActivity,activityResultLabels,type ActivityEntry,type ActivityFilter} from "../activity";
import {platformNames} from "../presentation";
import type {Course} from "../types";
import {ActivityFilterBar} from "./ActivityFilterBar";
import {EmptyState} from "./EmptyState";

type ActivityViewProps={
  activity:ActivityEntry[];
  courses:Course[];
  filter:ActivityFilter;
  onFilterChange:(filter:ActivityFilter)=>void;
  inspectCourse:(course:Course)=>void;
};

export function ExecutionRecordsView({activity,courses,filter:recordFilter,onFilterChange,inspectCourse}:ActivityViewProps){
  const recordedEvents=executionEvents(activity);
  const visibleRecords=filterActivity(recordedEvents,recordFilter);
  return <section className="sf-section">
    <div className="section-head"><h3>执行与核验记录</h3></div>
    <p className="sf-muted">本机最近记录，进程结束不代表平台确认完成。</p>
    <ActivityFilterBar events={recordedEvents} filter={recordFilter} onChange={onFilterChange} visibleCount={visibleRecords.length}/>
    {recordedEvents.length===0?<EmptyState icon={History} title="暂无执行或核验记录" description="实际启动、停止和核验后会在这里留下记录。"/>:visibleRecords.length===0?<EmptyState icon={Search} title="没有符合筛选条件的记录" description="请调整平台、结果或搜索条件。"/>:<div className="sf-history-list">{visibleRecords.map(event=>{
      const course=event.courseId?courses.find(course=>platformNames[course.platform]===event.platform&&course.course_id===event.courseId&&!course.stale):undefined;
      return <article key={event.id}><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time><div><strong>{event.action}</strong><span>{activityResultLabels[event.result]} · {event.platform}{course?" · "+course.title:event.courseId?" · 历史课程":" · 平台记录"}</span><p>{event.detail}</p></div>{course&&<button className="secondary" onClick={()=>inspectCourse(course)}>查看课程</button>}</article>;
    })}</div>}
  </section>;
}

export function OperationLogsView({activity,courses,filter:logFilter,onFilterChange,inspectCourse,onClear}:ActivityViewProps&{onClear:()=>void}){
  const visibleLogs=filterActivity(activity,logFilter);
  return <section>
    <div className="section-head"><h3>本机操作记录</h3>
      <button className="secondary" type="button" disabled={activity.length===0}
        onClick={onClear}>
        清空记录
      </button>
    </div>
    <ActivityFilterBar events={activity} filter={logFilter} onChange={onFilterChange} visibleCount={visibleLogs.length}/>
    {activity.length===0
      ?<EmptyState icon={Activity} title="暂无操作记录" description="平台连接检测、课程同步和任务操作会显示在这里。"/>
      :visibleLogs.length===0?<EmptyState icon={Search} title="没有符合筛选条件的记录" description="请调整平台、结果或搜索条件。"/>
      :<div className="sf-log-list">{visibleLogs.map(item=>{const course=item.courseId?courses.find(course=>platformNames[course.platform]===item.platform&&course.course_id===item.courseId&&!course.stale):undefined;return <article className="sf-log-row" key={item.id}>
        <span className={"sf-log-indicator "+item.result} aria-hidden="true"/>
        <div className="sf-log-main"><div><strong>{item.action}</strong><span>{activityResultLabels[item.result]} · {item.platform}{course?" · "+course.title:""}</span></div>
          <p>{item.detail}</p></div>
        <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
        {course&&<button type="button" className="secondary sf-log-course" onClick={()=>inspectCourse(course)}>查看课程</button>}
      </article>})}</div>}
  </section>;
}
