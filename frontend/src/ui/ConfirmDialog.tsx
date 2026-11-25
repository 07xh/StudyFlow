/** Adapted interaction pattern from the user's LightC-UI study source.
 * StudyFlow uses its own styling and platform-neutral API.
 */
import {useEffect,useId,useRef,type KeyboardEvent,type MouseEvent} from "react";
import {createPortal} from "react-dom";
import {AlertTriangle,ShieldCheck,X} from "lucide-react";
import {activateDialog,trapDialogTab} from "./modalInteraction";
import "./interactions.css";

interface ConfirmDialogProps {
  open:boolean;
  dark:boolean;
  title:string;
  description:string;
  warning?:string;
  confirmLabel?:string;
  cancelLabel?:string;
  danger?:boolean;
  busy?:boolean;
  onConfirm:()=>void;
  onCancel:()=>void;
}

export function ConfirmDialog({
  open,dark,title,description,warning,confirmLabel="确认",cancelLabel="取消",
  danger=false,busy=false,onConfirm,onCancel
}:ConfirmDialogProps){
  const titleId=useId();
  const detailId=useId();
  const dialogRef=useRef<HTMLElement>(null);
  const cancelRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    return activateDialog(()=>cancelRef.current,()=>dialogRef.current);
  },[open]);

  if(!open)return null;

  function onKeyboard(event:KeyboardEvent<HTMLElement>){
    if(event.key==="Escape"){
      event.preventDefault();event.stopPropagation();
      if(!busy)onCancel();
      return;
    }
    trapDialogTab(event,dialogRef.current);
  }

  function onBackdrop(event:MouseEvent<HTMLDivElement>){
    if(!busy&&event.target===event.currentTarget)onCancel();
  }

  return createPortal(
    <div className="sf-dialog-overlay" data-theme={dark?"dark":"light"}
      onMouseDown={onBackdrop}>
      <section ref={dialogRef} role={danger?"alertdialog":"dialog"} aria-modal="true"
        aria-labelledby={titleId} aria-describedby={detailId}
        className="sf-dialog" tabIndex={-1} onKeyDown={onKeyboard}>
        <div className="sf-dialog-heading">
          <span className={danger?"sf-dialog-symbol danger":"sf-dialog-symbol"}>
            {danger?<AlertTriangle size={21}/>:<ShieldCheck size={21}/>}
          </span>
          <h2 id={titleId}>{title}</h2>
          <button className="sf-dialog-close" type="button" aria-label="关闭确认窗口"
            disabled={busy} onClick={onCancel}><X size={18}/></button>
        </div>
        <div className="sf-dialog-body">
          <p id={detailId}>{description}</p>
          {warning&&<p className="sf-dialog-warning">{warning}</p>}
        </div>
        <div className="sf-dialog-actions">
          <button ref={cancelRef} type="button" className="sf-dialog-cancel"
            disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={danger?"sf-dialog-confirm danger":"sf-dialog-confirm"}
            disabled={busy} onClick={onConfirm}>{busy?"处理中…":confirmLabel}</button>
        </div>
      </section>
    </div>,document.body
  );
}
