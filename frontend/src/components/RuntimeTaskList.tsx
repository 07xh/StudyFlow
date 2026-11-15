import {useState} from 'react';
import type {ActivityEntry,TaskRecorder} from '../activity';
import type {Course,Platform} from '../types';
import {runnerNames,stopRuntime,type RuntimeTask} from '../runtimeTasks';
import {RunParameters} from './RunParameters';
export function RuntimeTaskList({tasks,courses,events,platform,onInspect,onRefresh,onEvent,desktop,compact=false,loading=false}:{tasks:RuntimeTask[];courses:Course[];events:ActivityEntry[];platform?:Platform;onInspect:(course:Course)=>void;onRefresh:()=>Promise<void>;onEvent?:TaskRecorder;desktop:boolean;compact?:boolean;loading?:boolean}){
 const [busy,setBusy]=useState(''),[message,setMessage]=useState('');
 const visible=tasks.filter(task=>(!platform||task.platform===platform)&&(task.unavailable||task.state!=='idle'));
 async function stop(task:RuntimeTask){
  setBusy(task.runner);setMessage('');
  try{await stopRuntime(task);onEvent?.('停止运行任务','success',runnerNames[task.runner]+' 已停止',{runner:task.runner,courseId:task.courseId??undefined,runId:task.runId??undefined});await onRefresh();}
  catch(error){const message=error instanceof Error?error.message:'任务操作未完成';setMessage(message);onEvent?.('停止运行任务','warning',message,{runner:task.runner,courseId:task.courseId??undefined,runId:task.runId??undefined});}finally{setBusy('');}
 }
 return <section className="sf-runtime-list" aria-label="实际运行任务">
  {!compact&&<div className="section-head"><span className="sf-muted">执行器当前状态</span><button className="secondary" disabled={!desktop||!!busy} onClick={()=>void onRefresh()}>刷新任务状态</button></div>}
  {visible.length===0?<p className="sf-muted">{loading?'正在读取运行任务状态…':desktop?'当前没有可展示的运行任务。':'请在 Windows 桌面版查看真实任务状态。'}</p>:visible.map(task=>{
   const course=task.courseId?courses.find(course=>course.platform===task.platform&&course.course_id===task.courseId&&!course.stale):undefined;
   const label=task.unavailable?'状态待刷新':task.state==='running'?'运行中':task.state==='stopped'?'已停止':task.exitCode===0?'进程已结束，完成情况待核验':'进程异常退出';
   const event=events.find(event=>event.runner===task.runner&&event.runId===task.runId&&event.parameters);
   return <article className="sf-runtime-task" key={task.runner}>
    <div className="section-head"><h4>{runnerNames[task.runner]}</h4><span className={'legacy-run-state'+(task.state==='running'&&!task.unavailable?' active':'')}>{label}</span></div>
    <strong>{task.runner==='yuketang'?'按雨课堂已配置的课堂范围批量运行':course?.title??'所属课程未在当前会话中确认'}</strong>
    <div className="actions">
     {course&&<button className="secondary" onClick={()=>onInspect(course)}>查看所属课程</button>}
     {!compact&&task.state==='running'&&<button className="secondary" disabled={!desktop||!!busy||task.unavailable||!task.runId} onClick={()=>void stop(task)}>{task.runner==='yuketang'?'停止雨课堂批量任务':'停止此运行任务'}</button>}
    </div>
    {!compact&&<RunParameters parameters={event?.parameters}/>}
   </article>;
  })}
  {message&&<p role="status">{message}</p>}
 </section>;
}
