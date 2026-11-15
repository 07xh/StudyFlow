import {useEffect,useRef,useState} from "react";
import {getVersion} from "@tauri-apps/api/app";
import {request,type ReleaseChangelogEntry} from "./bridge";
import {decideLaunch,markVersionSeen,readLaunchSnapshot,validVersion} from "./versionLaunch";

export type NotesDialogState={
  scope:"startup"|"history";version:string;
  loading:boolean;error:boolean;entries:ReleaseChangelogEntry[];
};

/** One app-wide changelog modal, gated behind the first-use consent screen. */
export function useReleaseChangelog(desktop:boolean,consentAccepted:boolean){
  const [snapshot]=useState(readLaunchSnapshot);
  const [currentVersion,setCurrentVersion]=useState("");
  const [dialog,setDialog]=useState<NotesDialogState|null>(null);
  const requestGeneration=useRef(0);

  function open(scope:"startup"|"history",version:string,previous?:string){
    const generation=++requestGeneration.current;
    setDialog({scope,version,loading:true,error:false,entries:[]});
    void request<{entries:ReleaseChangelogEntry[]}>({
      operation:"updates.changelog",current_version:version,
      ...(previous&&validVersion(previous)?{previous_version:previous}:{}),
      history:scope==="history"
    }).then(result=>{
      if(requestGeneration.current!==generation)return;
      setDialog(state=>state?.scope===scope?{...state,loading:false,entries:result.entries}:state);
    }).catch(()=>{
      if(requestGeneration.current!==generation)return;
      setDialog(state=>state?.scope===scope?{...state,loading:false,error:true}:state);
    });
  }
  useEffect(()=>{
    if(!desktop||!consentAccepted)return;
    const generation=++requestGeneration.current;
    void getVersion().then(version=>{
      if(requestGeneration.current!==generation)return;
      setCurrentVersion(version);
      const choice=decideLaunch(version,snapshot.previous,snapshot.existing);
      if(choice==="fresh")markVersionSeen(version);
      if(choice==="upgrade")open("startup",version,snapshot.previous??undefined);
    }).catch(()=>{/* Keep launch usable when native version metadata is unavailable. */});
    return ()=>{requestGeneration.current++;};
  },[desktop,consentAccepted,snapshot]);

  function close(){
    requestGeneration.current++;
    if(dialog?.scope==="startup")markVersionSeen(dialog.version);
    setDialog(null);
  }
  function openHistory(){
    if(!desktop||!consentAccepted||!currentVersion)return;
    open("history",currentVersion);
  }
  return {dialog,close,openHistory};
}
