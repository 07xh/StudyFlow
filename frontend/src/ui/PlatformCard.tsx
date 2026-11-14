import type {ReactNode} from "react";
import {BookOpen,ChevronRight,RefreshCw,Settings2} from "lucide-react";
import type {PlatformState} from "../types";
import type {PlatformDefinition} from "./registry";

interface Props {
  definition:PlatformDefinition;
  state:PlatformState;
  desktop:boolean;
  busy:boolean;
  expanded:boolean;
  onSync:()=>void;
  onToggleLogin:()=>void;
  onEnterCourses:()=>void;
  children:ReactNode;
}
export function PlatformCard({
  definition,state,desktop,busy,expanded,onSync,onToggleLogin,onEnterCourses,children
}:Props){
  const connected=state.status==="connected";
  const statusLabel=connected?"已登录":state.status==="error"?"连接异常":"未登录";
  return <article className="platform-card sf-platform-card">
    <div className="sf-platform-card-head">
      <div className="sf-platform-identity">
        <div className={"platform-logo sf-provider-"+definition.color} aria-hidden="true">
          {definition.mark}
        </div>
        <div className="sf-platform-identity-copy">
          <div className="sf-platform-title-line">
            <h3>{definition.name}</h3>
            <span className={connected?"sf-platform-status connected":"sf-platform-status"}>
              <span className="sf-status-dot"/>{statusLabel}
            </span>
          </div>
          <p>{state.message||definition.summary}</p>
        </div>
      </div>
      <div className="sf-platform-actions">
        <button className="primary sf-enter-courses" type="button" onClick={onEnterCourses}>
          <BookOpen size={16}/>进入课程<ChevronRight size={15}/>
        </button>
        <button className="secondary" type="button" disabled={!desktop||busy}
          aria-expanded={expanded} onClick={onToggleLogin}>
          <Settings2 size={15}/>{expanded?"收起":"登录 / 管理"}
        </button>
        <button className="secondary sf-sync-button" type="button" title="同步课程"
          aria-label={definition.name+"同步课程"} disabled={!desktop||busy} onClick={onSync}>
          <RefreshCw size={16}/>
        </button>
      </div>
    </div>
    {expanded&&<div className="sf-platform-expanded">
      <div className="sf-platform-expanded-label">
        <span>{definition.name} · 登录与连接</span>
        <span>{connected?"账号状态已验证":"需要完成登录或会话配置"}</span>
      </div>
      {children}
    </div>}
  </article>;
}
