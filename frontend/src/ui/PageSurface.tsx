/** Content-only page transition: no timers, no stale data or delayed event handlers. */
import type {ReactNode} from "react";
import "./interactions.css";
export function PageSurface({page,children}:{page:string;children:ReactNode}){
  return <div key={page} className="sf-page-surface">{children}</div>;
}
