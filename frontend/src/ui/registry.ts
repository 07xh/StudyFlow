import type {Platform,PlatformState} from "../types";

export interface PlatformDefinition {
  id:Platform;
  name:string;
  mark:string;
  summary:string;
  color:string;
  capabilities:{legacyLogin:boolean;videoList:boolean;sessionConfiguration:boolean};
}

/**
 * UI extension point. Only register an adapter after the local Python backend
 * supports its operations. An entry in this registry never implies login works.
 */
export const platformRegistry:readonly PlatformDefinition[] = [
  {id:"zhidao",name:"知到",mark:"知",summary:"智慧树课程与学习记录",color:"blue",
   capabilities:{legacyLogin:true,videoList:false,sessionConfiguration:false}},
  {id:"yuketang",name:"雨课堂",mark:"雨",summary:"课程、章节与视频信息",color:"cyan",
   capabilities:{legacyLogin:false,videoList:true,sessionConfiguration:true}},
];

export function platformInfo(id:Platform):PlatformDefinition|undefined {
  return platformRegistry.find(entry=>entry.id===id);
}

export function createInitialPlatformStates():Record<Platform,PlatformState> {
  const states={} as Record<Platform,PlatformState>;
  for (const item of platformRegistry) {
    states[item.id]={platform:item.id,status:"not_connected",
      message:"等待检测真实登录状态",courses:[]};
  }
  return states;
}
