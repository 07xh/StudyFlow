import {useEffect,useId,useRef,type KeyboardEvent,type MouseEvent,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {X} from "lucide-react";
import "./settingsDialog.css";

/** LightC-style second-level page; does not navigate away from the current workspace. */
export function SettingsDialog({open,dark,title,onClose,children,kicker="设置",compact=false,navigation,contentKey,footer}:{
  open:boolean;dark:boolean;title:string;onClose:()=>void;children:ReactNode;
  kicker?:string;compact?:boolean;navigation?:ReactNode;contentKey?:string;footer?:ReactNode;
}){
  const titleId=useId();
  const panel=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const lastFocus=useRef<HTMLElement|null>(null);
  const body=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(open&&body.current)body.current.scrollTop=0;
  },[open,contentKey]);
  useEffect(()=>{
    if(!open)return;
    lastFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const frame=window.requestAnimationFrame(()=>closeButton.current?.focus());
    return ()=>{
      window.cancelAnimationFrame(frame);
      document.body.style.overflow=previousOverflow;
      lastFocus.current?.focus();
    };
  },[open]);
  if(!open)return null;
  function handleKeys(event:KeyboardEvent<HTMLElement>){
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onClose();return;}
    if(event.key!=="Tab")return;
    const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )??[]).filter(item=>item.getClientRects().length>0);
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  function handleBackdrop(event:MouseEvent<HTMLDivElement>){
    if(event.target===event.currentTarget)onClose();
  }
  return createPortal(
    <div className={"app sf-shell sf-settings-overlay"+(dark?" dark":"")}
      data-theme={dark?"dark":"light"} onMouseDown={handleBackdrop}>
      <section className={"sf-settings-modal"+(compact?" sf-settings-modal--compact":"")} ref={panel} role="dialog" aria-modal="true"
        aria-labelledby={titleId} onKeyDown={handleKeys}>
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
