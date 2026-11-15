import {useEffect,useId,useState,type ReactNode} from "react";
import {ChevronDown} from "lucide-react";
import "./foundation.css";

interface Props{
  id:string;
  title:string;
  children:ReactNode;
  defaultExpanded?:boolean;
  /** Positive request counter opens this section even if previously collapsed. */
  expandRequest?:number;
}

const STORAGE_PREFIX="studyflow.section.expanded.v1.";

function initialExpanded(id:string,fallback:boolean):boolean{
  try{
    const saved=window.localStorage.getItem(STORAGE_PREFIX+id);
    return saved===null?fallback:saved==="true";
  }catch{
    return fallback;
  }
}

/**
 * Keeps children mounted while folded, so active playback and progress
 * monitors are not restarted or silently cancelled by visual preferences.
 */
export function CollapsibleSection({id,title,children,defaultExpanded=true,expandRequest=0}:Props){
  const controlsId=useId();
  const [expanded,setExpanded]=useState(()=>initialExpanded(id,defaultExpanded));

  useEffect(()=>{
    // The section can be reused for another course without leaking its state.
    setExpanded(initialExpanded(id,defaultExpanded));
  },[id,defaultExpanded]);

  useEffect(()=>{
    if(expandRequest>0)setExpanded(true);
  },[expandRequest]);

  function toggle(){
    setExpanded(previous=>{
      const next=!previous;
      try{window.localStorage.setItem(STORAGE_PREFIX+id,String(next));}
      catch{/* Keep this session's choice when storage is unavailable. */}
      return next;
    });
  }

  return <section className="sf-fold">
    <button type="button" className="sf-fold-toggle" onClick={toggle}
      aria-expanded={expanded} aria-controls={controlsId}
      aria-label={title+(expanded?"，收起":"，展开")}>
      <strong>{title}</strong>
      <ChevronDown size={17} className={expanded?"":"sf-fold-chevron-closed"}/>
    </button>
    <div className="sf-fold-body" id={controlsId} hidden={!expanded}>
      {children}
    </div>
  </section>;
}
