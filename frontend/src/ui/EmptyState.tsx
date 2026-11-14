import type {ReactNode} from "react";
import type {LucideIcon} from "lucide-react";
import {BookOpen} from "lucide-react";
/** Reusable empty state adapted from LightC-UI 2.18.3's EmptyState. */
interface Props {icon?:LucideIcon;title:string;description?:string;action?:ReactNode}
export function EmptyState({icon:Icon=BookOpen,title,description,action}:Props){
  return <div className="empty sf-empty">
    <div className="sf-empty-symbol"><Icon size={26}/></div>
    <strong>{title}</strong>
    {description&&<span>{description}</span>}
    {action&&<div className="sf-empty-action">{action}</div>}
  </div>;
}
