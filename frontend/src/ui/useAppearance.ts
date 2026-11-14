import {useEffect,useState} from "react";

const STORAGE_KEY="studyflow.appearance.v1";
export function useAppearance(){
  const [dark,setDark]=useState<boolean>(()=>{
    try {
      const stored=window.localStorage.getItem(STORAGE_KEY);
      return stored===null ? true : stored==="dark";
    } catch {return true;}
  });
  useEffect(()=>{
    try {window.localStorage.setItem(STORAGE_KEY,dark?"dark":"light");}
    catch {/* Storage may be disabled; UI still works. */}
  },[dark]);
  return {dark,toggleTheme:()=>setDark(current=>!current)};
}
