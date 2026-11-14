import {useEffect,useState} from "react";

const STORAGE_KEY="studyflow.appearance.v1";
export type ThemeMode="light"|"dark"|"system";
function loadMode():ThemeMode {
  try {
    const stored=window.localStorage.getItem(STORAGE_KEY);
    return stored==="light"||stored==="dark"||stored==="system"?stored:"dark";
  }catch {return "dark";}
}
export function useAppearance(){
  const [mode,setMode]=useState<ThemeMode>(loadMode);
  const [systemDark,setSystemDark]=useState(()=>{
    try{return window.matchMedia("(prefers-color-scheme: dark)").matches;}
    catch{return true;}
  });
  useEffect(()=>{
    try{window.localStorage.setItem(STORAGE_KEY,mode);}
    catch{/* Preview environments may disable storage. */}
  },[mode]);
  useEffect(()=>{
    if(typeof window.matchMedia!=="function")return;
    const media=window.matchMedia("(prefers-color-scheme: dark)");
    const update=()=>setSystemDark(media.matches);
    update();
    media.addEventListener("change",update);
    return ()=>media.removeEventListener("change",update);
  },[]);
  const dark=mode==="system"?systemDark:mode==="dark";
  return {dark,mode,setMode,toggleTheme:()=>setMode(current=>current==="dark"?"light":"dark")};
}
