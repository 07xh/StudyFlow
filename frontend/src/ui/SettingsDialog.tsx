import {useEffect,useId,useRef,type KeyboardEvent,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {X} from "lucide-react";
import {activateDialog,trapDialogTab} from "./modalInteraction";
import "./settingsDialog.css";

/** LightC-style second-level page; does not navigate away from the current workspace. */
export function SettingsDialog({open,dark,title,onClose,children,kicker="设置",compact=false,navigation,contentKey,footer,wide=false}:{
  open:boolean;dark:boolean;title:string;onClose:()=>void;children:ReactNode;
  kicker?:string;compact?:boolean;wide?:boolean;navigation?:ReactNode;contentKey?:string;footer?:ReactNode;
}){
  const titleId=useId();
  const panel=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const body=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(open&&body.current)body.current.scrollTop=0;
  },[open,contentKey]);
  useEffect(()=>{
    if(!open)return;
    return activateDialog(()=>closeButton.current,()=>panel.current);
  },[open]);
  if(!open)return null;
  function handleKeys(event:KeyboardEvent<HTMLElement>){
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onClose();return;}
    trapDialogTab(event,panel.current);
  }
  return createPortal(
    <div className={"app sf-shell sf-settings-overlay"+(dark?" dark":"")}
      data-theme={dark?"dark":"light"}>
      <section className={"sf-settings-modal"+(compact?" sf-settings-modal--compact":"")+(wide?" sf-settings-modal--wide":"")} ref={panel} role="dialog" aria-modal="true"
        aria-labelledby={titleId} tabIndex={-1} onKeyDown={handleKeys}>
        <header className="sf-settings-modal-heading">
          <div><span className="sf-settings-modal-kicker">{kicker}</span><h2 id={titleId}>{title}</h2></div>
          <button ref={closeButton} type="button" className="sf-settings-modal-close"
            aria-label="关闭设置面板" onClick={onClose}><X size={18}/></button>
        </header>
        {navigation&&<div className="sf-settings-modal-navigation">{navigation}</div>}
        <div className="sf-settings-modal-body" ref={body}>{children}</div>
        {footer&&<footer className="sf-settings-modal-footer">{footer}</footer>}
      </section>
    </div>,document.body);
}
