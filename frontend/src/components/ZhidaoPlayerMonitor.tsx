import type {TaskRecorder} from "../activity";
import {useEffect,useRef} from "react";
import {invoke} from "@tauri-apps/api/core";
import {request,type ZhidaoProgressSnapshot} from "../bridge";
import type {Course} from "../types";

type Status={
  state:"idle"|"running"|"exited"|"stopped";
  courseKey:string|null;
  runId:string|null;
  exitCode:number|null;
};
type Props={
  desktop:boolean;
  onCoursesUpdated:(courses:Course[])=>void;
  onEvent?:TaskRecorder;
};

/** Bound a stuck IPC/bridge read without treating a timeout as course completion. */
async function boundedRead<T>(operation:Promise<T>,milliseconds:number):Promise<T>{
  let timeoutId:number|undefined;
  try{
    return await Promise.race<T>([operation,new Promise<never>((_,reject)=>{
      timeoutId=window.setTimeout(()=>reject(new Error("READ_TIMEOUT")),milliseconds);
    })]);
  }finally{
    if(timeoutId!==undefined)window.clearTimeout(timeoutId);
  }
}

/** Keeps the official-player close -> server verification chain alive across sidebar navigation. */
export function ZhidaoPlayerMonitor({desktop,onCoursesUpdated,onEvent}:Props){
  const verifiedRuns=useRef(new Set<string>());
  const lastAttempt=useRef(new Map<string,number>());
  const onCoursesUpdatedRef=useRef(onCoursesUpdated);
  const onEventRef=useRef(onEvent);
  useEffect(()=>{onCoursesUpdatedRef.current=onCoursesUpdated;},[onCoursesUpdated]);
  useEffect(()=>{onEventRef.current=onEvent;},[onEvent]);

  useEffect(()=>{
    if(!desktop)return;
    let live=true;
    let checking=false;
    const check=async()=>{
      if(checking)return;
      checking=true;
      try{
        const status=await boundedRead(invoke<Status>("zhidao_player_status"),15000);
        if(!live||status.state!=="exited"||status.exitCode!==0||
           !status.runId||!status.courseKey||verifiedRuns.current.has(status.runId))return;
        // A transient readback failure must not mark this run permanently verified.
        // Back off retries to protect the legitimate read-only server endpoint.
        const last=lastAttempt.current.get(status.runId)??0;
        const now=Date.now();
        if(now-last<60000)return;
        lastAttempt.current.set(status.runId,now);
        try{
          const snapshot=await boundedRead(request<ZhidaoProgressSnapshot>({
            operation:"zhidao.progress.verify",course_key:status.courseKey
          }),195000);
          if(!live)return;
          const target=snapshot.courses.find(course=>course.platform==="zhidao"&&
            course.course_id===status.courseKey&&!course.stale&&
            course.progress_evidence==="server_verified"&&course.verified_at&&
            typeof course.progress_percent==="number");
          if(!target){
            onEventRef.current?.("播放器关闭后核验","warning",
              "官方播放器已关闭，但当前课程尚无新服务器核验证据；将按间隔重试。",
              {courseId:status.courseKey,runId:status.runId,runner:"official"});
            return;
          }
          verifiedRuns.current.add(status.runId);
          onCoursesUpdatedRef.current(snapshot.courses);
          const detail=snapshot.incomplete
            ?"官方播放器已关闭；当前课程已核验，其他课程可能仍有未确认记录。"
            :"官方播放器已关闭；已重新读取该课程的服务器学习记录。";
          onEventRef.current?.("播放器关闭后核验",snapshot.incomplete?"warning":"success",detail,{courseId:status.courseKey,runId:status.runId,runner:"official"});
        }catch{
          if(!live)return;
          onEventRef.current?.("播放器关闭后核验","warning",
            "官方播放器已关闭，但服务器核验暂时失败；将按间隔重试。",
            {courseId:status.courseKey,runId:status.runId,runner:"official"});
        }
      }catch{
        // The monitor is best-effort; the platform page still exposes manual verification.
      }finally{checking=false;}
    };
    void check();
    const timer=window.setInterval(()=>{void check();},1000);
    return ()=>{live=false;window.clearInterval(timer);};
  },[desktop]);

  return null;
}
