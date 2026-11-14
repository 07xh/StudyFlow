import {invoke} from "@tauri-apps/api/core";
import type {Platform,PlatformState,Course} from "./types";

export type Video = {id:string;name:string;chapter:string};
export type Config = {session_id:string;csrf_token:string;classroom_id:string;university_id:string;sign:string};
export type BridgeRequest =
  | {id:string;version:1;operation:"ping"}
  | {id:string;version:1;operation:"platform.status"}
  | {id:string;version:1;operation:"courses.list";platform:Platform}
  | {id:string;version:1;operation:"videos.list";platform:"yuketang"}
  | {id:string;version:1;operation:"yuketang.configure";configuration:Config}
  | {id:string;version:1;operation:"yuketang.clear"}
  | {id:string;version:1;operation:"zhidao.qr.start"|"zhidao.qr.status"|"zhidao.qr.cancel"};

export type BridgeResponse<T> =
  | {id:string|null;ok:true;data:T}
  | {id:string|null;ok:false;error:string};

export function isDesktop():boolean {
  return Boolean((window as Window & {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__);
}

const errorLabels:Record<string,string> = {
  PLATFORM_NOT_READY:"课程读取失败：检查原版运行时、登录状态、网络或课堂配置",
  CREDENTIAL_STORAGE_FAILED:"Windows 凭据保存失败，请检查系统凭据管理器",
  UNKNOWN_PLATFORM:"不支持该平台",
  INVALID_REQUEST:"请求参数错误",
  UNSUPPORTED_VERSION:"通信协议版本不匹配"
};

export async function request<T>(message:Omit<BridgeRequest,"id"|"version">):Promise<T> {
  if(!isDesktop())throw new Error("当前为浏览器预览，需启动 Windows 桌面版才能连接真实课程");
  const payload={...message,id:crypto.randomUUID(),version:1} as BridgeRequest;
  const result=await invoke<BridgeResponse<T>>("bridge_request",{request:payload});
  if(!result.ok)throw new Error(errorLabels[result.error]||result.error);
  return result.data;
}

export async function fetchStatuses():Promise<PlatformState[]>{
  const list=await request<Array<{platform:Platform;connected:boolean;message:string}>>({operation:"platform.status"});
  return list.map(p=>({platform:p.platform,status:p.connected?"connected":"not_connected",
    message:p.message,courses:[] as Course[]}));
}

export async function openLegacyZhidao():Promise<void> {
  if(!isDesktop())throw new Error("请在 Windows 桌面版中使用");
  await invoke("launch_zhidao_legacy");
}

/** Ephemeral QR image, never persist or log this base64 string. */
export type ZhidaoQrStage =
  | "idle" | "busy" | "requesting" | "ready" | "scanned" | "confirming"
  | "verified" | "unavailable" | "rejected" | "expired" | "cancelled"
  | "failed" | "environment-error";
export type ZhidaoQrState = {stage:ZhidaoQrStage;image_png_base64?:string|null};

export function zhidaoQrCommand(action:"start"|"status"|"cancel"):Promise<ZhidaoQrState>{
  const operation = ({
    start:"zhidao.qr.start",
    status:"zhidao.qr.status",
    cancel:"zhidao.qr.cancel"
  } as const)[action];
  return request<ZhidaoQrState>({operation});
}
