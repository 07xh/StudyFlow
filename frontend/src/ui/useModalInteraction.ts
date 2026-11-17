import {useEffect,useRef,type KeyboardEvent,type RefObject} from "react";

type ModalLayer={
  panel:RefObject<HTMLElement>;
  initialFocus:RefObject<HTMLElement>;
  opener:HTMLElement|null;
};
const layers:ModalLayer[]=[];
let bodyOverflow="";
const focusable='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Shared focus, keyboard and scroll ownership for nested modal surfaces. */
export function useModalInteraction({open,panel,initialFocus,onClose,busy=false}:{
  open:boolean;panel:RefObject<HTMLElement>;initialFocus:RefObject<HTMLElement>;
  onClose:()=>void;busy?:boolean;
}){
  const layerRef=useRef<ModalLayer|null>(null);
  useEffect(()=>{
    if(!open)return;
    const layer:ModalLayer={panel,initialFocus,
      opener:document.activeElement instanceof HTMLElement?document.activeElement:null};
    layerRef.current=layer;
    if(layers.length===0){
      bodyOverflow=document.body.style.overflow;
      document.body.style.overflow="hidden";
    }
    layers.push(layer);
    const frame=window.requestAnimationFrame(()=>{
      if(layers[layers.length-1]===layer)initialFocus.current?.focus();
    });
    return ()=>{
      window.cancelAnimationFrame(frame);
      const index=layers.indexOf(layer);
      const wasTop=index===layers.length-1;
      if(index>=0)layers.splice(index,1);
      layerRef.current=null;
      if(layers.length===0)document.body.style.overflow=bodyOverflow;
      if(!wasTop)return;
      const remaining=layers[layers.length-1];
      if(layer.opener?.isConnected&&(!remaining||remaining.panel.current?.contains(layer.opener))){
        layer.opener.focus();
      }else remaining?.initialFocus.current?.focus();
    };
  },[open,panel,initialFocus]);

  return (event:KeyboardEvent<HTMLElement>)=>{
    const layer=layerRef.current;
    if(!layer||layers[layers.length-1]!==layer)return;
    if(event.key==="Escape"){
      event.preventDefault();event.stopPropagation();
      if(!busy)onClose();
      return;
    }
    if(event.key!=="Tab")return;
    const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>(focusable)??[])
      .filter(item=>item.getClientRects().length>0);
    if(!controls.length){event.preventDefault();return;}
    const first=controls[0],last=controls[controls.length-1];
    const outside=!panel.current?.contains(document.activeElement);
    if(event.shiftKey&&(document.activeElement===first||outside)){
      event.preventDefault();last.focus();
    }else if(!event.shiftKey&&(document.activeElement===last||outside)){
      event.preventDefault();first.focus();
    }
  };
}
