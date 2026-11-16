import {useEffect,useId,useRef,useState,type KeyboardEvent,type MouseEvent,type PointerEvent as ReactPointerEvent,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {Info,Palette,RefreshCw,X} from "lucide-react";
import "./globalSettings.css";

export type GlobalSettingsTab="general"|"updates"|"about";
const groups=[
  {id:"general" as const,label:"通用设置",icon:Palette},
  {id:"updates" as const,label:"版本与更新",icon:RefreshCw},
  {id:"about" as const,label:"关于与开源",icon:Info}
];
const WIDTH_KEY="studyflow.settings.nav-width.v1";
const MIN_WIDTH=150,MAX_WIDTH=340,DEFAULT_WIDTH=208;

function savedNavWidth(){
  try{
    const value=window.localStorage.getItem(WIDTH_KEY);
    if(value===null)return DEFAULT_WIDTH;
    const width=Number(value);
    return Number.isFinite(width)?Math.min(MAX_WIDTH,Math.max(MIN_WIDTH,Math.round(width))):DEFAULT_WIDTH;
  }catch{return DEFAULT_WIDTH;}
}
function maxNavWidth(viewport:number){
  const dialogWidth=Math.min(960,viewport*.76,viewport-24);
  return Math.min(MAX_WIDTH,Math.max(MIN_WIDTH,Math.floor(dialogWidth*.4)));
}
function persistWidth(value:number){
  try{window.localStorage.setItem(WIDTH_KEY,String(value));}
  catch{/* The saved layout preference is optional. */}
}

/** One LightC-inspired global settings surface, independent of platform parameter dialogs. */
export function GlobalSettingsModal({open,dark,activeTab,onTabChange,onClose,children}:{
  open:boolean;dark:boolean;activeTab:GlobalSettingsTab;
  onTabChange:(tab:GlobalSettingsTab)=>void;onClose:()=>void;children:ReactNode;
}){
  const titleId=useId();
  const [mounted,setMounted]=useState(open);
  const [entered,setEntered]=useState(false);
  const [width,setWidth]=useState(savedNavWidth);
  const [viewport,setViewport]=useState(()=>typeof window==="undefined"?1150:window.innerWidth);
  const [resizing,setResizing]=useState(false);
  const widthRef=useRef(width);
  const dragRef=useRef<{startX:number;initialWidth:number}|null>(null);
  const panelRef=useRef<HTMLElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const openerRef=useRef<HTMLElement|null>(null);
  const scrollRef=useRef<HTMLDivElement>(null);
  const limit=maxNavWidth(viewport);
  const shownWidth=Math.min(width,limit);
  widthRef.current=width;

  useEffect(()=>{
    if(open){
      setMounted(true);
      const frame=window.requestAnimationFrame(()=>setEntered(true));
      return ()=>window.cancelAnimationFrame(frame);
    }
    if(!mounted)return;
    setEntered(false);
    const timeout=setTimeout(()=>setMounted(false),190);
    return ()=>clearTimeout(timeout);
  },[open,mounted]);
  useEffect(()=>{
    if(!open)return;
    openerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const frame=window.requestAnimationFrame(()=>closeRef.current?.focus());
    return ()=>{
      window.cancelAnimationFrame(frame);
      document.body.style.overflow=oldOverflow;
      if(openerRef.current?.isConnected)openerRef.current.focus();
    };
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const resize=()=>setViewport(window.innerWidth);
    window.addEventListener("resize",resize);
    return ()=>window.removeEventListener("resize",resize);
  },[open]);
  useEffect(()=>{
    if(open&&scrollRef.current)scrollRef.current.scrollTop=0;
  },[open,activeTab]);
  useEffect(()=>{
    if(!open)return;
    const move=(event:PointerEvent)=>{
      const drag=dragRef.current;
      if(!drag)return;
      const next=Math.min(maxNavWidth(window.innerWidth),Math.max(MIN_WIDTH,Math.round(drag.initialWidth+event.clientX-drag.startX)));
      widthRef.current=next;
      setWidth(next);
    };
    const stop=()=>{
      if(!dragRef.current)return;
      dragRef.current=null;
      setResizing(false);
      persistWidth(widthRef.current);
    };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",stop);
    window.addEventListener("pointercancel",stop);
    window.addEventListener("blur",stop);
    return ()=>{
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",stop);
      window.removeEventListener("pointercancel",stop);
      window.removeEventListener("blur",stop);
    };
  },[open]);
  function startDrag(event:ReactPointerEvent<HTMLDivElement>){
    if(viewport<=620)return;
    event.preventDefault();
    dragRef.current={startX:event.clientX,initialWidth:shownWidth};
    setResizing(true);
  }
  function resizeWithKeys(event:KeyboardEvent<HTMLDivElement>){
    if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;
    event.preventDefault();
    const next=Math.min(limit,Math.max(MIN_WIDTH,shownWidth+(event.key==="ArrowRight"?12:-12)));
    widthRef.current=next;
    setWidth(next);
    persistWidth(next);
  }
  function keydown(event:KeyboardEvent<HTMLElement>){
    if(!panelRef.current?.contains(event.target as Node))return;
    if(event.key==="Escape"){
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if(event.key!=="Tab")return;
    const controls=Array.from(panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(item=>item.getClientRects().length>0);
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  function backdrop(event:MouseEvent<HTMLDivElement>){
    if(open&&event.target===event.currentTarget)onClose();
  }
  if(!mounted&&!open)return null;
  return createPortal(
    <div className={"app sf-shell sf-global-settings-overlay"+(dark?" dark":"")}
      data-state={entered&&open?"open":"closed"} data-theme={dark?"dark":"light"}
      onMouseDown={backdrop}>
      <section className={"sf-global-settings-modal"+(resizing?" sf-global-settings-resizing":"")}
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keydown}>
        <aside className="sf-global-settings-nav" style={{width:shownWidth}}>
          <div className="sf-global-settings-brand"><h2 id={titleId}>设置</h2></div>
          <nav aria-label="设置分类">
            {groups.map(group=><button key={group.id} type="button"
              aria-current={activeTab===group.id?"page":undefined}
              className={activeTab===group.id?"active":""}
              onClick={()=>onTabChange(group.id)}>
              <group.icon size={17}/><span>{group.label}</span>
            </button>)}
          </nav>
          <div role="separator" tabIndex={0} aria-orientation="vertical"
            aria-label="调整设置导航宽度"
            aria-valuemin={MIN_WIDTH} aria-valuemax={limit} aria-valuenow={shownWidth}
            className="sf-global-settings-resize" onPointerDown={startDrag} onKeyDown={resizeWithKeys}/>
        </aside>
        <div className="sf-global-settings-main">
          <header className="sf-global-settings-header">
            <h3>{groups.find(group=>group.id===activeTab)?.label}</h3>
            <button ref={closeRef} type="button" aria-label="关闭设置" onClick={onClose}><X size={18}/></button>
          </header>
          <div className="sf-global-settings-content" ref={scrollRef}>{children}</div>
        </div>
      </section>
    </div>,document.body
  );
}
