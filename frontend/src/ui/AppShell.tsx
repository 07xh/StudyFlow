import {useEffect,useState,type ReactNode} from "react";
import {BookOpen,ChevronRight,GraduationCap,LayoutDashboard,Moon,PanelLeftClose,PanelLeftOpen,Settings,ShieldCheck,Sun} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import {NoticeBanner} from "./NoticeBanner";
import {PageSurface} from "./PageSurface";
import "./foundation.css";

export type Page="home"|"courses"|"platforms"|"settings";
const workspaceNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"home",label:"学习总览",icon:LayoutDashboard},
  {id:"courses",label:"课程中心",icon:BookOpen},
  {id:"platforms",label:"平台管理",icon:ShieldCheck}
];
const systemNavigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"settings",label:"偏好设置",icon:Settings}
];
const titles:Record<Page,string>={
  home:"学习总览",courses:"课程中心",platforms:"平台管理",settings:"偏好设置"
};

interface Props {
  page:Page;onNavigate:(next:Page)=>void;dark:boolean;onThemeToggle:()=>void;
  desktop:boolean;notice:string;onDismissNotice:()=>void;compact:boolean;children:ReactNode;
}
export function AppShell({page,onNavigate,dark,onThemeToggle,desktop,notice,onDismissNotice,compact,children}:Props){
  const [collapsed,setCollapsed]=useState(()=>{
    try{return window.localStorage.getItem("studyflow.nav.collapsed")==="true";}
    catch{return false;}
  });
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.collapsed",String(collapsed));}
    catch{/* Sidebar remains usable without persisted preference. */}
  },[collapsed]);
  const renderItems=(items:typeof workspaceNavigation,label:string)=><nav aria-label={label}>
    {items.map(item=><button key={item.id} type="button"
      title={item.label} aria-label={item.label} aria-current={page===item.id?"page":undefined}
      className={page===item.id?"nav active":"nav"}
      onClick={()=>onNavigate(item.id)}>
      <item.icon size={19}/><span className="nav-label">{item.label}</span>
      {page===item.id&&<ChevronRight size={15} className="right"/>}
    </button>)}
  </nav>;
  return <div className={["app","sf-shell",dark?"dark":"",collapsed?"sf-collapsed":"",compact?"sf-compact":""].filter(Boolean).join(" ")}>
    <aside className="sidebar" aria-label="主导航">
      <div className="brand">
        <div className="brand-icon"><GraduationCap size={22}/></div>
        <div><strong>学序</strong><small>StudyFlow</small></div>
      </div>
      <div className="sf-nav-head">
        <span className="section-label">工作空间</span>
        <button className="sf-nav-toggle" title={collapsed?"展开侧边栏":"折叠侧边栏"}
          type="button" aria-label={collapsed?"展开侧边栏":"折叠侧边栏"}
          aria-expanded={!collapsed} onClick={()=>setCollapsed(current=>!current)}>
          {collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}
        </button>
      </div>
      <div className="sf-nav-group">
        {renderItems(workspaceNavigation,"学习工作空间")}
      </div>
      <div className="sf-nav-group sf-nav-system">
        <span className="section-label">系统</span>
        {renderItems(systemNavigation,"系统设置")}
      </div>
      <div className="sidebar-bottom">
        <div className="sf-side-status">
          <span className="sf-side-dot"/>{desktop?"桌面运行":"浏览器预览"}
        </div>
      </div>
    </aside>
    <main className="main" id="main-content">
      <header className="sf-header">
        <div className="sf-page-heading">
          <span className="eyebrow">STUDYFLOW</span>
          <h1>{titles[page]}</h1>
        </div>
        <div className="sf-header-actions">
          <span className="sf-mode"><span className="sf-status-dot"/>{desktop?"桌面客户端":"浏览器预览"}</span>
          <button className="theme-button" type="button" aria-label={dark?"切换浅色主题":"切换深色主题"}
            onClick={onThemeToggle}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button>
        </div>
      </header>
      <NoticeBanner message={notice} onDismiss={onDismissNotice}/>
      <PageSurface page={page}>{children}</PageSurface>
    </main>
  </div>;
}
