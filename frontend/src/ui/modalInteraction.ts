import type {KeyboardEvent} from "react";

// Reference-count body locks so closing a nested confirmation cannot unlock
// the page behind a still-open settings dialog.
const locks:symbol[]=[];
let previousOverflow="";

export function acquireModalScrollLock():()=>boolean{
  const token=Symbol("modal");
  if(locks.length===0){
    previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
  }
  locks.push(token);
  return ()=>{
    const index=locks.indexOf(token);
    if(index<0)return false;
    const wasTop=index===locks.length-1;
    locks.splice(index,1);
    if(locks.length===0)document.body.style.overflow=previousOverflow;
    return wasTop;
  };
}

export function trapDialogTab(event:KeyboardEvent<HTMLElement>,panel:HTMLElement|null){
  if(event.key!=="Tab"||!panel)return;
  const controls=Array.from(panel.querySelectorAll<HTMLElement>(
    'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )).filter(item=>item.tabIndex>=0&&item.getClientRects().length>0&&!item.closest('[hidden],[inert],[aria-hidden="true"]'));
  if(controls.length===0){
    event.preventDefault();panel.focus();return;
  }
  const first=controls[0],last=controls[controls.length-1];
  if(!controls.includes(document.activeElement as HTMLElement)){
    event.preventDefault();(event.shiftKey?last:first).focus();
  }else if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus();
  }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus();
  }
}
