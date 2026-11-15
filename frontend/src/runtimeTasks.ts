import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {getLegacyStatus,stopLegacy,type LegacyTaskState} from './legacyPlayback';
import {discardTaskRecovery,readTaskRecovery} from './taskRecovery';
import type {Platform} from './types';
import type {Runner} from './activity';
export type RuntimeTask={runner:Runner;platform:Platform;state:LegacyTaskState;courseId:string|null;runId:string|null;exitCode:number|null;unavailable?:boolean};
export const runnerNames:Record<Runner,string>={official:'知到官方播放器',zhs:'知到 ZHS 原版',yuketang:'雨课堂批量任务'};
export function useRuntimeTasks(desktop:boolean){
 const [tasks,setTasks]=useState<RuntimeTask[]>([]);
 const [loading,setLoading]=useState(desktop);
 const revision=useRef(0);
 const refresh=useCallback(async()=>{
  if(!desktop)return;const request=++revision.current;
  const results=await Promise.allSettled([
   invoke<{state:LegacyTaskState;courseKey:string|null;runId:string|null;exitCode:number|null}>('zhidao_player_status'),
   getLegacyStatus('zhidao'),getLegacyStatus('yuketang')
  ]);
  if(request!==revision.current)return;
  setLoading(false);
  // Normal process exit clears only that run's hint; an exit is not proof of course completion.
  for(let index=1;index<=2;index++){
   const result=results[index];
   if(result.status!=='fulfilled')continue;
   const state=result.value;
   if(!('run_id' in state)||!('exit_code' in state))continue;
   if(state.state!=='exited'||state.exit_code!==0||!state.run_id)continue;
   const platform=index===1?'zhidao':'yuketang';
   if(readTaskRecovery().some(r=>r.platform===platform&&r.runId===state.run_id))
    discardTaskRecovery(platform,state.run_id);
  }
  setTasks(previous=>results.map((result,index)=>{
   const runner:Runner=index===0?'official':index===1?'zhs':'yuketang';
   const platform:Platform=index===2?'yuketang':'zhidao';
   if(result.status==='rejected')return {...(previous.find(task=>task.runner===runner)??{runner,platform,state:'idle' as const,courseId:null,runId:null,exitCode:null}),unavailable:true};
   const value=result.value;
   if('courseKey' in value)return {runner,platform,state:value.state,courseId:value.courseKey,runId:value.runId,exitCode:value.exitCode};
   return {runner,platform,state:value.state,courseId:value.course_id,runId:value.run_id??null,exitCode:value.exit_code};
  }));
 },[desktop]);
 useEffect(()=>{setLoading(desktop);void refresh();if(!desktop)return;const timer=window.setInterval(()=>void refresh(),2000);return ()=>{revision.current++;window.clearInterval(timer);};},[desktop,refresh]);
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
