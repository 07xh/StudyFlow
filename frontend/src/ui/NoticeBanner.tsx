/** Dismissible status surface; keeps important IPC failures visible until dismissed. */
import {Info,X} from "lucide-react";
import "./interactions.css";
interface Props {message:string;onDismiss:()=>void;}
export function NoticeBanner({message,onDismiss}:Props){
  if(!message)return null;
  return <div className="sf-notice-banner" role="status" aria-live="polite">
    <Info size={17} aria-hidden="true"/>
    <span>{message}</span>
    <button type="button" aria-label="关闭提示" onClick={onDismiss}><X size={17}/></button>
  </div>;
}
