import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  Activity,BookOpen,ChevronDown,History,
  LayoutDashboard,Layers3,ListChecks,Moon,Navigation,Pin,
  RefreshCw,Settings,Sun,X
} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import {NoticeBanner} from "./NoticeBanner";
import {PageSurface} from "./PageSurface";
import "./foundation.css";

export type Page="home"|"courses"|"tasks"|"platforms"|"platform-zhidao"|
  "platform-yuketang"|"records"|"logs"|"settings";
const workspaceNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"home",label:"首页",icon:LayoutDashboard},
  {id:"courses",label:"课程中心",icon:BookOpen},
  {id:"tasks",label:"学习任务",icon:ListChecks},
  {id:"platforms",label:"学习平台",icon:Layers3},
  {id:"records",label:"学习记录",icon:History},
  {id:"logs",label:"日志中心",icon:Activity}
];
const platformNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"platform-zhidao",label:"知到",icon:BookOpen},
  {id:"platform-yuketang",label:"雨课堂",icon:BookOpen}
];
const systemNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"settings",label:"设置",icon:Settings}
];
const titles:Record<Page,string>={
  home:"学习总览",courses:"课程中心",tasks:"学习任务",platforms:"学习平台",
  "platform-zhidao":"知到","platform-yuketang":"雨课堂",
  records:"学习记录",logs:"日志中心",settings:"设置"
};

function readNavPinned():boolean{
  try{return window.localStorage.getItem("studyflow.nav.pinned")==="true";}
  catch{return false;}
}
function readPlatformExpanded():boolean{
  try{return window.localStorage.getItem("studyflow.nav.platform-expanded")!=="false";}
  catch{return true;}
}

interface Props {
  page:Page;onNavigate:(next:Page)=>void;dark:boolean;onThemeToggle:()=>void;
  onRefresh:()=>void;desktop:boolean;notice:string;onDismissNotice:()=>void;
  compact:boolean;children:ReactNode;
}
export function AppShell({
  page,onNavigate,dark,onThemeToggle,onRefresh,desktop,notice,onDismissNotice,compact,children
}:Props){
  const [navPinned,setNavPinned]=useState(readNavPinned);
  const [navOpen,setNavOpen]=useState(readNavPinned);
  const [platformExpanded,setPlatformExpanded]=useState(readPlatformExpanded);
  const navRootRef=useRef<HTMLDivElement|null>(null);
  const closeTimerRef=useRef<number|null>(null);

  function cancelCloseTimer(){
    if(closeTimerRef.current!==null){
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current=null;
    }
  }
  function closeNavigation(){
    cancelCloseTimer();
    setNavPinned(false);
    setNavOpen(false);
  }
  function toggleNavigationPin(){
    cancelCloseTimer();
    const next=!navPinned;
    setNavPinned(next);
    setNavOpen(next);
  }
  function handlePointerEnter(event:ReactPointerEvent<HTMLElement>){
    if(event.pointerType==="touch")return;
    cancelCloseTimer();
    setNavOpen(true);
  }
  function handlePointerLeave(event:ReactPointerEvent<HTMLElement>){
    if(event.pointerType==="touch"||navPinned)return;
    cancelCloseTimer();
    closeTimerRef.current=window.setTimeout(()=>{closeTimerRef.current=null;setNavOpen(false);},180);
  }
  function handleNavBlur(event:ReactFocusEvent<HTMLDivElement>){
    const nextTarget=event.relatedTarget;
    if(nextTarget instanceof Node&&navRootRef.current?.contains(nextTarget))return;
    if(!navPinned)setNavOpen(false);
  }

  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.pinned",String(navPinned));}
    catch{/* Navigation remains available for the current session. */}
  },[navPinned]);
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.platform-expanded",String(platformExpanded));}
    catch{/* The current navigation state remains available for this session. */}
  },[platformExpanded]);
  useEffect(()=>{
    if(!navOpen)return;
    const handleOutsidePointerDown=(event:PointerEvent)=>{
      const target=event.target;
      if(target instanceof Node&&!navRootRef.current?.contains(target)){
        setNavPinned(false);
        setNavOpen(false);
      }
    };
    const handleKeyDown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        setNavPinned(false);
        setNavOpen(false);
      }
    };
    document.addEventListener("pointerdown",handleOutsidePointerDown);
    document.addEventListener("keydown",handleKeyDown);
    return ()=>{
      document.removeEventListener("pointerdown",handleOutsidePointerDown);
      document.removeEventListener("keydown",handleKeyDown);
    };
  },[navOpen]);
  useEffect(()=>()=>cancelCloseTimer(),[]);

  const platformActive=page==="platforms"||page==="platform-zhidao"||page==="platform-yuketang";
  const renderItem=(item:{id:Page;label:string;icon:LucideIcon},nested=false)=>
    <button key={item.id} type="button" title={item.label} aria-label={item.label}
      tabIndex={0}
      aria-current={page===item.id?"page":undefined}
      className={["nav",page===item.id?"active":"",nested?"sf-nav-child":""].filter(Boolean).join(" ")}
      onClick={()=>onNavigate(item.id)}>
      <item.icon size={nested?16:18}/>
      <span className="nav-label">{item.label}</span>
      {page===item.id&&<span className="sf-floating-nav__active-dot" aria-hidden="true"/>}
    </button>;
  const renderItems=(items:typeof workspaceNavigation,label:string)=><nav className="sf-floating-nav__nav" aria-label={label}>
    {items.map(item=>item.id==="platforms"
      ?<div className="sf-platform-nav" key={item.id}>
        <div className="sf-platform-nav-parent">
          <button type="button" title="学习平台" aria-label="学习平台"
            tabIndex={0}
            className={["nav",platformActive?"active":""].filter(Boolean).join(" ")}
            aria-current={page==="platforms"?"page":undefined}
            onClick={()=>{setPlatformExpanded(true);onNavigate("platforms");}}>
            <Layers3 size={18}/><span className="nav-label">学习平台</span>
            {page==="platforms"&&<span className="sf-floating-nav__active-dot" aria-hidden="true"/>}
          </button>
          <button type="button" className="sf-nav-expand"
            tabIndex={0}
            aria-label={platformExpanded?"收起学习平台":"展开学习平台"}
            aria-expanded={platformExpanded} title={platformExpanded?"收起":"展开"}
            onClick={()=>setPlatformExpanded(current=>!current)}>
            <ChevronDown size={15} className={platformExpanded?"":"sf-chevron-closed"}/>
          </button>
        </div>
        {navOpen&&platformExpanded&&<div className="sf-subnav" role="group" aria-label="平台二级页面">
          {platformNavigation.map(child=>renderItem(child,true))}
        </div>}
      </div>
      :renderItem(item))}
  </nav>;

  return <div className={["app","sf-shell",dark?"dark":"",compact?"sf-compact":""].filter(Boolean).join(" ")}>
    <div className="sf-floating-nav" ref={navRootRef}
      onFocusCapture={()=>{cancelCloseTimer();setNavOpen(true);}}
      onBlurCapture={handleNavBlur}>
      <button type="button"
        className={["sf-floating-nav__trigger",navOpen?"is-open":""].filter(Boolean).join(" ")}
        aria-label={navPinned?"取消固定并收起导航":navOpen?"固定导航":"打开导航"}
        aria-expanded={navOpen} aria-pressed={navPinned} aria-controls="sf-floating-navigation"
        title={navPinned?"取消固定导航":navOpen?"固定导航":"打开导航"}
        onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}
        onClick={toggleNavigationPin}>
        <Navigation size={18}/>
      </button>
      <aside id="sf-floating-navigation"
        className={["sf-floating-nav__panel",navOpen?"is-open":""].filter(Boolean).join(" ")}
        aria-label="主导航"
        onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
        <div className="sf-floating-nav__header">
          <button type="button" className="sf-floating-nav__trigger"
            aria-label={navPinned?"取消固定并收起导航":navOpen?"固定导航":"展开导航"}
            aria-expanded={navOpen} aria-pressed={navPinned} aria-controls="sf-floating-navigation"
            title={navPinned?"取消固定并收起导航":navOpen?"固定导航":"展开导航"}
            tabIndex={0} onClick={toggleNavigationPin}>
            {navPinned?<Pin size={17}/>:<Navigation size={17}/>}
          </button>
          {navOpen&&<span className="sf-floating-nav__brand-copy">
            <strong>学序</strong><small>StudyFlow</small>
          </span>}
          {navOpen&&<div className="sf-floating-nav__header-actions">
            <button type="button" className="sf-floating-nav__action"
              title="关闭导航" aria-label="关闭导航" tabIndex={0}
              onClick={closeNavigation}>
              <X size={15}/>
            </button>
          </div>}
        </div>
        <div className="sf-floating-nav__section">
          <span className="sf-floating-nav__section-label">工作空间</span>
          {renderItems(workspaceNavigation,"学习工作空间")}
        </div>
        <div className="sf-floating-nav__section sf-floating-nav__system">
          <span className="sf-floating-nav__section-label">系统</span>
          {renderItems(systemNavigation,"系统设置")}
        </div>
      </aside>
    </div>
    <main className="main" id="main-content">
      <header className="sf-header">
        <div className="sf-page-heading"><h1>{titles[page]}</h1></div>
        <div className="sf-header-actions">
          <span className="sf-mode"><span className="sf-status-dot"/>
            {desktop?"Windows 桌面":"浏览器预览"}
          </span>
          <button className="theme-button" type="button" title="刷新连接"
            aria-label="刷新连接" disabled={!desktop} onClick={onRefresh}>
            <RefreshCw size={17}/>
          </button>
          <button className="theme-button" type="button"
            aria-label={dark?"切换浅色主题":"切换深色主题"}
            onClick={onThemeToggle}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button>
        </div>
      </header>
      <NoticeBanner message={notice} onDismiss={onDismissNotice}/>
      <PageSurface page={page}>{children}</PageSurface>
    </main>
  </div>;
}
