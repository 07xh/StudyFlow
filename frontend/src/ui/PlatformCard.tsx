import {PlayCircle,QrCode,RefreshCw} from "lucide-react";
import type {PlatformState} from "../types";
import type {PlatformDefinition} from "./registry";

interface Props {
  definition:PlatformDefinition;state:PlatformState;desktop:boolean;busy:boolean;
  onSync:()=>void;onLogin:()=>void;onVideos:()=>void;
}
export function PlatformCard({definition,state,desktop,busy,onSync,onLogin,onVideos}:Props){
  const connected=state.status==="connected";
  const message=state.message&&state.message!=="等待检测真实登录状态"?state.message:"";
  return <article className="platform-card sf-platform-card">
    <div className="platform-top">
      <div className="sf-platform-identity">
        <div className={"platform-logo sf-provider-"+definition.color} aria-hidden="true">{definition.mark}</div>
        <div className="sf-platform-name"><h3>{definition.name}</h3>
          <span className={connected?"status sf-connected":"status"}>
            <span className="sf-status-dot"/>{connected?"已连接":state.status==="error"?"连接异常":"未连接"}
          </span>
        </div>
      </div>
    </div>
    {message&&<p className="sf-platform-message">{message}</p>}
    <div className="actions">
      <button className="primary" type="button" disabled={!desktop||busy} onClick={onSync}>
        <RefreshCw size={15}/>同步课程
      </button>
      {definition.capabilities.legacyLogin&&
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={onLogin}>
          <QrCode size={15}/>扫码登录
        </button>}
      {definition.capabilities.videoList&&
        <button className="secondary" type="button" disabled={!desktop||busy} onClick={onVideos}>
          <PlayCircle size={15}/>章节视频
        </button>}
    </div>
  </article>;
}
