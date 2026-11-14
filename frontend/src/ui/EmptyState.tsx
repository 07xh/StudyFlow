import type {ReactNode} from "react";
import type {LucideIcon} from "lucide-react";
import {BookOpen} from "lucide-react";

interface Props {icon?:LucideIcon;title:string;description?:string;action?:ReactNode}

/** A compact, accessible empty-data presentation owned by StudyFlow. */
export function EmptyState({icon:Icon=BookOpen,title,description,action}:Props){
  return <div className="empty sf-empty" aria-live="polite" aria-atomic="true">
    <div className="sf-empty-symbol" aria-hidden="true"><Icon size={26}/></div>
    <strong>{title}</strong>
    {description&&<span>{description}</span>}
    {action&&<div className="sf-empty-action">{action}</div>}
  </div>;
}
