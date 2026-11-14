import type {Platform,PlatformState,Course} from "./types";

/** IPC wire contract. No HTTP localhost service is started in the browser preview. */
export type BridgeRequest =
  | {id:string;version:1;operation:"ping"}
  | {id:string;version:1;operation:"platform.status"}
  | {id:string;version:1;operation:"courses.list";platform:Platform};

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
