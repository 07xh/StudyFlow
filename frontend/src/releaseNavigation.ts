/** Open official release notes in the system browser on Tauri desktop. */
import {invoke} from "@tauri-apps/api/core";
import type {MouseEvent} from "react";
import {isDesktop} from "./bridge";

export const OFFICIAL_RELEASES_URL="https://github.com/07xh/StudyFlow/releases";

export async function openOfficialReleases(event:MouseEvent<HTMLAnchorElement>,onError:(message:string)=>void):Promise<void>{
  if(!isDesktop())return;
  event.preventDefault();
  try{await invoke("studyflow_open_releases");}
  catch{onError("无法打开系统浏览器，请手动访问："+OFFICIAL_RELEASES_URL);}
}
