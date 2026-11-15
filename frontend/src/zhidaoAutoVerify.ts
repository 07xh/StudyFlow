import {useEffect,useRef,useState} from "react";
import {friendlyBridgeError,request,type ZhidaoProgressSnapshot} from "./bridge";

type Options={
  desktop:boolean;
  connected:boolean;
  enabled:boolean;
  courseId:string;
  onSnapshot:(snapshot:ZhidaoProgressSnapshot)=>void;
};

/**
 * One app-level, read-only poller. Navigation changes which panels are mounted,
 * not whether the selected course is monitored. Closing the app stops the timer.
 * Never generate playback events or claim a lesson was completed.
 */
export function useZhidaoAutoVerify({desktop,connected,enabled,courseId,onSnapshot}:Options){
  const latestSnapshot=useRef(onSnapshot);
  latestSnapshot.current=onSnapshot;
  const inFlight=useRef(false);
  const lastAttempt=useRef({courseId:"",at:0});
  const [lastError,setLastError]=useState("");

  useEffect(()=>{
    if(!desktop||!connected||!enabled||!courseId){
      lastAttempt.current={courseId:"",at:0};
      setLastError("");
      return;
    }
    let active=true;
    const check=()=>{
      if(!active||inFlight.current)return;
      const now=Date.now();
      if(lastAttempt.current.courseId===courseId&&now-lastAttempt.current.at<60000)return;
      lastAttempt.current={courseId,at:now};
      inFlight.current=true;
      void request<ZhidaoProgressSnapshot>({
        operation:"zhidao.progress.verify",course_key:courseId
      }).then(snapshot=>{
        if(!active)return;
        latestSnapshot.current(snapshot);
        setLastError(snapshot.incomplete?"本次服务器核验存在未完成项；仅显示已确认记录。":"");
      }).catch(error=>{
        if(active)setLastError(friendlyBridgeError(error));
      }).finally(()=>{inFlight.current=false;});
    };
    check();
    const timer=window.setInterval(check,120000);
    window.addEventListener("focus",check);
    return ()=>{
      active=false;
      window.clearInterval(timer);
      window.removeEventListener("focus",check);
    };
  },[desktop,connected,enabled,courseId]);

  return lastError;
}
