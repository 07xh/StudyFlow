import type {Platform,PlatformState} from "./types";

/** Explicitly disconnected until a real local service has been connected. */
export const initialPlatforms: Record<Platform,PlatformState> = {
  zhidao: {platform:"zhidao",status:"not_connected",message:"尚未接入知到登录与课程服务",courses:[]},
  yuketang: {platform:"yuketang",status:"not_connected",message:"尚未接入雨课堂登录与课程服务",courses:[]}
};
