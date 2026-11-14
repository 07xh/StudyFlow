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
  onEvent?:(action:string,result:"success"|"warning",detail:string)=>void;
};

/** Keeps the official-player close -> server verification chain alive across sidebar navigation. */
export function ZhidaoPlayerMonitor({desktop,onCoursesUpdated,onEvent}:Props){
  const verifiedRuns=useRef(new Set<string>());
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
        const status=await invoke<Status>("zhidao_player_status");
        if(!live||status.state!=="exited"||status.exitCode!==0||
           !status.runId||!status.courseKey||verifiedRuns.current.has(status.runId))return;
        verifiedRuns.current.add(status.runId);
        try{
          const snapshot=await request<ZhidaoProgressSnapshot>({
            operation:"zhidao.progress.verify",course_key:status.courseKey
          });
          if(!live)return;
          onCoursesUpdatedRef.current(snapshot.courses);
          const detail=snapshot.incomplete
            ?"官方播放器已关闭；单课核验返回部分数据，未确认记录不会标记为完成。"
            :"官方播放器已关闭；已重新读取该课程的服务器学习记录。";
          onEventRef.current?.("播放器关闭后核验",snapshot.incomplete?"warning":"success",detail);
        }catch(error){
          const detail="官方播放器已关闭，但服务器核验失败："+(error instanceof Error?error.message:"未知错误");
          onEventRef.current?.("播放器关闭后核验","warning",detail);
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
