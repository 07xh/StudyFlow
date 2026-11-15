import {useEffect,useRef,useState} from "react";
import {getVersion} from "@tauri-apps/api/app";
import {request,type AvailableUpdate,type ReleaseChangelogEntry} from "./bridge";
import {bundledReleaseNotes} from "./packagedReleaseNotes";
import {
  decideLaunch,markVersionSeen,readLaunchSnapshot,validVersion,
  shouldPromptForRelease,readDismissedRelease,markReleaseDismissed
} from "./versionLaunch";

export type NotesDialogState={
  scope:"startup"|"history"|"available";version:string;installedVersion?:string;
  loading:boolean;error:boolean;entries:ReleaseChangelogEntry[];
  source?:"github"|"bundled";
};

const CHECK_INTERVAL_MS=20*60*1000;

/** One app-wide modal: published updates, installed upgrade notes, and history. */
export function useReleaseChangelog(desktop:boolean,consentAccepted:boolean){
  const [snapshot]=useState(readLaunchSnapshot);
  const [currentVersion,setCurrentVersion]=useState("");
  const [dialog,setDialog]=useState<NotesDialogState|null>(null);
  const dialogRef=useRef(dialog);
  dialogRef.current=dialog;
  const requestGeneration=useRef(0);
  const lastCheckAt=useRef(0);
  const lastNotesRequest=useRef<{scope:"startup"|"history";version:string;previous?:string}|null>(null);

  function open(scope:"startup"|"history",version:string,previous?:string){
    lastNotesRequest.current={scope,version,previous};
    const generation=++requestGeneration.current;
    setDialog({scope,version,loading:true,error:false,entries:[]});
    void request<{entries:ReleaseChangelogEntry[]}>({
      operation:"updates.changelog",current_version:version,
      ...(previous&&validVersion(previous)?{previous_version:previous}:{}),
      history:scope==="history"
    }).then(result=>{
      if(requestGeneration.current!==generation)return;
      // Empty GitHub history can also mean that this older installed RC has no
      // published metadata. Show verified, bundled candidate notes instead.
      const fallback=result.entries.length?[]:bundledReleaseNotes(version,previous,scope==="history");
      setDialog(state=>state?.scope===scope?{
        ...state,loading:false,entries:result.entries.length?result.entries:fallback,
        source:result.entries.length?"github":fallback.length?"bundled":undefined
      }:state);
    }).catch(()=>{
      if(requestGeneration.current!==generation)return;
      const fallback=bundledReleaseNotes(version,previous,scope==="history");
      setDialog(state=>state?.scope===scope?{
        ...state,loading:false,error:fallback.length===0,entries:fallback,
        source:fallback.length?"bundled":undefined
      }:state);
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

  useEffect(()=>{
    if(!desktop||!consentAccepted||!currentVersion||dialog!==null)return;
    let active=true,busy=false;
    async function checkPublishedRelease(){
      if(!active||busy||dialogRef.current)return;
      // Window focus can fire repeatedly while navigating other apps.
      // Avoid exhausting GitHub's anonymous API allowance.
      if(Date.now()-lastCheckAt.current<5*60*1000)return;
      lastCheckAt.current=Date.now();
      busy=true;
      try{
        const result=await request<{release:AvailableUpdate|null}>({
          operation:"updates.check",current_version:currentVersion
        });
        if(!active||dialogRef.current||!result.release)return;
        const release=result.release;
        if(!shouldPromptForRelease(currentVersion,release.version,readDismissedRelease()))return;
        // updates.check already includes the real GitHub Release body; do not
        // make a second, potentially failing changelog request for a new update.
        setDialog({
          scope:"available",version:release.version,installedVersion:currentVersion,
          loading:false,error:false,source:"github",entries:[{
            version:release.version,title:"学序 "+release.version,
            notes:release.notes,published_at:""
          }]
        });
      }catch{
        // Network failures are reported by the manual update panel; a failed
        // background probe must never interrupt lessons or show false releases.
      }finally{busy=false;}
    }
    void checkPublishedRelease();
    const timer=window.setInterval(()=>void checkPublishedRelease(),CHECK_INTERVAL_MS);
    window.addEventListener("focus",checkPublishedRelease);
    return ()=>{
      active=false;
      window.clearInterval(timer);
      window.removeEventListener("focus",checkPublishedRelease);
    };
  },[desktop,consentAccepted,currentVersion,dialog]);

  function close(){
    requestGeneration.current++;
    if(dialog?.scope==="startup")markVersionSeen(dialog.version);
    if(dialog?.scope==="available")markReleaseDismissed(dialog.version);
    setDialog(null);
  }
  function retry(){
    if(dialog?.scope==="available")return;
    const last=lastNotesRequest.current;
    if(last)open(last.scope,last.version,last.previous);
  }
  function openHistory(){
    if(!desktop||!consentAccepted||!currentVersion)return;
    open("history",currentVersion);
  }
  return {dialog,close,retry,openHistory};
}
