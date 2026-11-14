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
  variant?:"overview"|"account";
}
export function PlatformCard({
  definition,state,desktop,busy,expanded,onSync,onToggleLogin,onEnterCourses,children,variant="overview"
}:Props){
  const connected=state.status==="connected";
  const statusLabel=connected?"已登录":state.status==="connecting"?"连接中":state.status==="error"?"连接异常":"未登录";
  const message=state.message&&state.message!=="等待检测真实登录状态"?state.message:"";
  return <article className="platform-card sf-platform-card">
    <div className="sf-platform-card-head">
      <div className="sf-platform-identity">
        <div className={"platform-logo sf-provider-"+definition.color} aria-hidden="true">
          {definition.mark}
        </div>
        <div className="sf-platform-identity-copy">
          <div className="sf-platform-title-line">
            <h3>{variant==="account"?"账号与连接":definition.name}</h3>
            <span className={connected?"sf-platform-status connected":"sf-platform-status"}>
              <span className="sf-status-dot"/>{statusLabel}
            </span>
          </div>
          {message&&<p>{message}</p>}
        </div>
      </div>
      <div className="sf-platform-actions">
        {variant==="overview"&&<>
        <button className={(connected?"primary":"secondary")+" sf-enter-courses"} type="button" onClick={onEnterCourses}>
          <BookOpen size={16}/>进入课程<ChevronRight size={15}/>
        </button>
        </>}
        <button className={!connected?"primary":"secondary"} type="button" disabled={busy}
          aria-expanded={expanded} onClick={onToggleLogin}>
          <Settings2 size={15}/>{expanded?"收起账号设置":connected?"管理账号":"登录平台"}
        </button>
        {variant==="overview"&&<button className="secondary sf-sync-button" type="button" title="同步课程"
          aria-label={definition.name+"同步课程"} disabled={!desktop||busy||!connected} onClick={onSync}>
          <RefreshCw size={16}/>
        </button>}
      </div>
    </div>
    {expanded&&<div className="sf-platform-expanded">
      {variant==="overview"&&<div className="sf-platform-expanded-label">
        <span>{definition.name} · 登录与连接</span>
        
      </div>}
      {children}
    </div>}
  </article>;
}
