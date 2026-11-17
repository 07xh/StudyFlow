import type {Platform,PlatformState} from "../types";

export interface PlatformDefinition {
  id:Platform;
  name:string;
  mark:string;
  color:string;
}

/**
 * UI extension point. Only register an adapter after the local Python backend
 * supports its operations. An entry in this registry never implies login works.
 */
export const platformRegistry:readonly PlatformDefinition[] = [
  {id:"zhidao",name:"知到",mark:"知",color:"blue"},
  {id:"yuketang",name:"雨课堂",mark:"雨",color:"rose"},
  {id:"xuexitong",name:"学习通",mark:"学",color:"violet"},
  {id:"ucampus",name:"U校园",mark:"U",color:"blue"},
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
