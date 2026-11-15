/** Open official release notes in the system browser on Tauri desktop. */
import {invoke} from "@tauri-apps/api/core";
import type {MouseEvent} from "react";
import {isDesktop,request} from "./bridge";

export const OFFICIAL_RELEASES_URL="https://github.com/07xh/StudyFlow/releases";

export async function openOfficialReleases(event:MouseEvent<HTMLAnchorElement>,onError:(message:string)=>void):Promise<void>{
  if(!isDesktop())return;
  event.preventDefault();
  try{await invoke("studyflow_open_releases");}
  catch{onError("无法打开系统浏览器，请手动访问："+OFFICIAL_RELEASES_URL);}
}


/** Resolve newest *published and installable* version, never the GitHub list's first row. */
export async function openLatestRelease(event:MouseEvent<HTMLAnchorElement>,onError:(message:string)=>void):Promise<void>{
  if(!isDesktop())return;
  event.preventDefault();
  try{
    const {version}=await request<{version:string|null}>({operation:"updates.latest"});
    if(!version || !/^v\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)){
      onError("未找到已发布且包含可校验 Windows x64 安装包的版本。可查看 GitHub 全部历史版本。");
      return;
    }
    await invoke("studyflow_open_releases",{tag:version});
  }catch{
    onError("无法核验或打开 GitHub 最新版本，请稍后重试；也可以打开全部历史版本。");
  }
}
