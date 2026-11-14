import {PlayCircle,RefreshCw} from "lucide-react";
import type {PlatformState} from "../types";
import type {PlatformDefinition} from "./registry";

interface Props {
  definition:PlatformDefinition;state:PlatformState;desktop:boolean;busy:boolean;
  onSync:()=>void;onLogin:()=>void;onVideos:()=>void;
}
export function PlatformCard({definition,state,desktop,busy,onSync,onLogin,onVideos}:Props){
  const connected=state.status==="connected";
  return <article className="platform-card sf-platform-card">
    <div className="platform-top">
      <div className={"platform-logo sf-provider-"+definition.color} aria-hidden="true">{definition.mark}</div>
      <span className={connected?"status sf-connected":"status"}>
        <span className="sf-status-dot"/>{connected?"已连接":state.status==="error"?"连接异常":"未连接"}
      </span>
    </div>
    <h3>{definition.name}</h3>
    <span className="sf-provider-summary">{definition.summary}</span>
    <p>{state.message}</p>
    <div className="actions">
      <button className="secondary" type="button" disabled={!desktop||busy} onClick={onSync}>
        <RefreshCw size={16}/>同步课程
      </button>
      {definition.capabilities.legacyLogin&&
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={onLogin}>扫码登录</button>}
      {definition.capabilities.videoList&&
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={onVideos}>
          <PlayCircle size={16}/>章节与视频
        </button>}
    </div>
  </article>;
}
