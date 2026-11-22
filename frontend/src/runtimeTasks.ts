import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {getLegacyStatus,stopLegacy,type LegacyTaskState} from './legacyPlayback';
import {discardTaskRecovery,readTaskRecovery} from './taskRecovery';
type LegacyPlatform = 'zhidao' | 'yuketang';
import type {Runner} from './activity';
export type RuntimeTask={runner:Runner;platform:LegacyPlatform;state:LegacyTaskState;courseId:string|null;runId:string|null;exitCode:number|null;unavailable?:boolean};
export const runnerNames:Record<Runner,string>={official:'知到官方播放器',zhs:'知到 ZHS 原版',yuketang:'雨课堂批量任务'};
// One slow platform must not block live status from the others.
const runtimeRunners:Runner[]=['official','zhs','yuketang'];
// Stable status snapshots should not rerender the entire App workspace every
// two seconds. A change in availability or task identity still propagates.
function sameRuntimeTask(left:RuntimeTask,right:RuntimeTask):boolean{
 return left.runner===right.runner && left.platform===right.platform &&
   left.state===right.state && left.courseId===right.courseId &&
   left.runId===right.runId && left.exitCode===right.exitCode &&
   Boolean(left.unavailable)===Boolean(right.unavailable);
}
function upsertRuntimeTask(previous:RuntimeTask[], next:RuntimeTask):RuntimeTask[]{
 const current=previous.find(task=>task.runner===next.runner);
 if(current && sameRuntimeTask(current,next))return previous;
 const byRunner=new Map(previous.map(task=>[task.runner,task]));
 byRunner.set(next.runner,next);
 return runtimeRunners.flatMap(runner=>{const task=byRunner.get(runner);return task?[task]:[];});
}
export function useRuntimeTasks(desktop:boolean){
 const [tasks,setTasks]=useState<RuntimeTask[]>([]);
 const snapshot=useRef<RuntimeTask[]>([]);
 const [loading,setLoading]=useState(desktop);
 const loadingPending=useRef(desktop);
 const publish=useCallback((next:RuntimeTask)=>{
   const updated=upsertRuntimeTask(snapshot.current,next);
   if(updated===snapshot.current)return;
   snapshot.current=updated;
   setTasks(updated);
 },[]);
 const finishLoading=useCallback(()=>{
   if(!loadingPending.current)return;
   loadingPending.current=false;
   setLoading(false);
 },[]);
 const revision=useRef(0);
 // Guard each backend independently. A hanging player status must not
 // prevent polling the ZHS or rain-classroom runtime.
 const inFlight=useRef<Array<number|null>>([null,null,null]);
 const requestSequence=useRef(0);
 const refresh=useCallback(async()=>{
  if(!desktop)return;
  const generation=revision.current;
  const reads=[
   ()=>invoke<{state:LegacyTaskState;courseKey:string|null;runId:string|null;exitCode:number|null}>('zhidao_player_status'),
   ()=>getLegacyStatus('zhidao'),
   ()=>getLegacyStatus('yuketang')
  ] as const;
  const updates=reads.map(async(read,index)=>{
   if(inFlight.current[index]!==null)return;
   const token=++requestSequence.current;
   inFlight.current[index]=token;
   const runner=runtimeRunners[index];
   const platform:LegacyPlatform=index===2?'yuketang':'zhidao';
   try{
    const value=await read();
    if(generation!==revision.current)return;
    finishLoading();
    if(index>0&&'run_id' in value&&'exit_code' in value&&
       value.state==='exited'&&value.exit_code===0&&value.run_id&&
       readTaskRecovery().some(record=>record.platform===platform&&record.runId===value.run_id)){
      // A clean process exit clears the recovery hint, never certifies study completion.
      discardTaskRecovery(platform,value.run_id);
    }
    const next:RuntimeTask='courseKey' in value
      ?{runner,platform,state:value.state,courseId:value.courseKey,runId:value.runId,exitCode:value.exitCode}
      :{runner,platform,state:value.state,courseId:value.course_id,runId:value.run_id??null,exitCode:value.exit_code};
    publish(next);
   }catch{
    if(generation!==revision.current)return;
    finishLoading();
    const prior=snapshot.current.find(task=>task.runner===runner);
    publish({
      ...(prior??{runner,platform,state:'idle' as const,courseId:null,runId:null,exitCode:null}),
      unavailable:true
    });
   }finally{
    if(inFlight.current[index]===token)inFlight.current[index]=null;
   }
  });
  await Promise.all(updates);
 },[desktop,finishLoading,publish]);
 useEffect(()=>{
  loadingPending.current=desktop;
  setLoading(desktop);
  void refresh();
  if(!desktop)return;
  const timer=window.setInterval(()=>void refresh(),2000);
  return ()=>{
   revision.current++;
   inFlight.current=[null,null,null];
   window.clearInterval(timer);
  };
 },[desktop,refresh]);
 return {tasks,refresh,loading};
}
export async function stopRuntime(task:RuntimeTask){
 if(!task.runId)throw Error("任务标识尚未确认，请刷新后再操作。");
 if(task.runner==='official'){
  const status=await invoke<{state:LegacyTaskState;runId:string|null;courseKey:string|null}>('zhidao_player_status');
  if(status.state!=='running'||status.runId!==task.runId||status.courseKey!==task.courseId)throw Error('运行任务已变化，请刷新后再操作。');
  await invoke('zhidao_player_stop',{expectedRunId:task.runId});
 }else{
  const status=await getLegacyStatus(task.platform);
  if(status.state!=='running'||status.run_id!==task.runId||status.course_id!==task.courseId)throw Error('运行任务已变化，请刷新后再操作。');
  await stopLegacy(task.platform,task.runId);
  discardTaskRecovery(task.platform,task.runId);
 }
}
