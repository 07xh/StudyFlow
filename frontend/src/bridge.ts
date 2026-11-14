import type {Platform,PlatformState,Course} from "./types";

/** IPC wire contract. No HTTP localhost service is started in the browser preview. */
export type BridgeRequest =
  | {id:string;version:1;operation:"ping"}
  | {id:string;version:1;operation:"platform.status"}
  | {id:string;version:1;operation:"courses.list";platform:Platform}
  | {id:string;version:1;operation:"zhidao.qr.start"|"zhidao.qr.status"|"zhidao.qr.cancel"};

export type BridgeResponse<T> =
  | {id:string|null;ok:true;data:T}
  | {id:string|null;ok:false;error:string};

export interface StudyFlowTransport {
  request<T>(message:BridgeRequest):Promise<BridgeResponse<T>>;
}

export async function fetchPlatformStatuses(transport:StudyFlowTransport):Promise<PlatformState[]>{
  const reply=await transport.request<Array<{platform:Platform;connected:boolean;message:string}>>({
    id:"platform-status",version:1,operation:"platform.status"
  });
  if(!reply.ok)throw new Error(reply.error);
  return reply.data.map(p=>({
    platform:p.platform,status:p.connected?"connected":"not_connected",
    message:p.message,courses:[] as Course[]
  }));
}

/** Ephemeral, per-attempt QR image; never persist this data URL in browser storage. */
export type ZhidaoQrStage =
  | "idle" | "busy" | "requesting" | "ready" | "scanned" | "confirming"
  | "verified" | "unavailable" | "rejected" | "expired" | "cancelled"
  | "failed" | "environment-error";
export type ZhidaoQrState = {
  stage:ZhidaoQrStage;
  image_png_base64?:string|null;
};

export function zhidaoQrCommand(
  transport:StudyFlowTransport,
  action:"start"|"status"|"cancel"
):Promise<BridgeResponse<ZhidaoQrState>> {
  return transport.request<ZhidaoQrState>({
    id:"zhidao-qr-"+action,version:1,operation:"zhidao.qr."+action
  });
}
