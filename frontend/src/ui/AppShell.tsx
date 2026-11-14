import {useEffect,useState,type ReactNode} from "react";
import {
  Activity,BookOpen,ChevronDown,ChevronRight,GraduationCap,History,
  LayoutDashboard,Layers3,ListChecks,Moon,PanelLeftClose,PanelLeftOpen,
  RefreshCw,Settings,Sun
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

interface Props {
  page:Page;onNavigate:(next:Page)=>void;dark:boolean;onThemeToggle:()=>void;
  onRefresh:()=>void;desktop:boolean;notice:string;onDismissNotice:()=>void;
  compact:boolean;children:ReactNode;
}
export function AppShell({
  page,onNavigate,dark,onThemeToggle,onRefresh,desktop,notice,onDismissNotice,compact,children
}:Props){
  const [collapsed,setCollapsed]=useState(()=>{
    try{
      const saved=window.localStorage.getItem("studyflow.nav.collapsed.v2");
      return saved===null?true:saved==="true";
    }catch{return true;}
  });
  const [platformExpanded,setPlatformExpanded]=useState(()=>{
    try{return window.localStorage.getItem("studyflow.nav.platform-expanded")!=="false";}
    catch{return true;}
  });
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.collapsed.v2",String(collapsed));}
    catch{/* Navigation stays usable in this session. */}
  },[collapsed]);
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.platform-expanded",String(platformExpanded));}
    catch{/* Navigation stays usable in this session. */}
  },[platformExpanded]);
  const platformActive=page==="platforms"||page==="platform-zhidao"||page==="platform-yuketang";
  const renderItem=(item:{id:Page;label:string;icon:LucideIcon},nested=false)=>
    <button key={item.id} type="button" title={item.label} aria-label={item.label}
      aria-current={page===item.id?"page":undefined}
      className={[ "nav",page===item.id?"active":"",nested?"sf-nav-child":""].filter(Boolean).join(" ")}
      onClick={()=>onNavigate(item.id)}>
      <item.icon size={nested?16:19}/><span className="nav-label">{item.label}</span>
      {page===item.id&&<ChevronRight size={14} className="right"/>}
    </button>;
  const renderItems=(items:typeof workspaceNavigation,label:string)=><nav aria-label={label}>
    {items.map(item=>item.id==="platforms"
      ?<div className="sf-platform-nav" key={item.id}>
        <div className="sf-platform-nav-parent">
          <button type="button" title="学习平台" aria-label="学习平台"
            className={["nav",platformActive?"active":""].filter(Boolean).join(" ")}
            aria-current={page==="platforms"?"page":undefined}
            onClick={()=>{setPlatformExpanded(true);onNavigate("platforms");}}>
            <Layers3 size={19}/><span className="nav-label">学习平台</span>
          </button>
          <button type="button" className="sf-nav-expand"
            aria-label={platformExpanded?"收起学习平台":"展开学习平台"}
            aria-expanded={platformExpanded} title={platformExpanded?"收起":"展开"}
            onClick={()=>setPlatformExpanded(current=>!current)}>
            <ChevronDown size={15} className={platformExpanded?"":"sf-chevron-closed"}/>
          </button>
        </div>
        {platformExpanded&&<div className="sf-subnav" role="group" aria-label="平台二级页面">
          {platformNavigation.map(child=>renderItem(child,true))}
        </div>}
      </div>
      :renderItem(item))}
  </nav>;

  return <div className={["app","sf-shell",dark?"dark":"",collapsed?"sf-collapsed":"",compact?"sf-compact":""].filter(Boolean).join(" ")}>
    <aside className="sidebar" aria-label="主导航">
      <div className="sf-sidebar-panel">
      <div className="brand">
        <div className="brand-icon"><GraduationCap size={23}/></div>
        <div><strong>学序</strong><small>StudyFlow</small></div>
      </div>
      <div className="sf-nav-head">
        <span className="section-label">工作空间</span>
        <button className="sf-nav-toggle" type="button"
          title={collapsed?"展开侧边栏":"折叠侧边栏"}
          aria-label={collapsed?"展开侧边栏":"折叠侧边栏"}
          aria-expanded={!collapsed} onClick={()=>setCollapsed(current=>!current)}>
          {collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}
        </button>
      </div>
      <div className="sf-nav-group">{renderItems(workspaceNavigation,"学习工作空间")}</div>
      <div className="sf-nav-group sf-nav-system">
        <span className="section-label">系统</span>
        {renderItems(systemNavigation,"系统设置")}
      </div>
      <div className="sidebar-bottom">
        <div className="sf-side-status"><span className="sf-side-dot"/>
          {desktop?"Windows 桌面":"浏览器预览"}
        </div>
      </div>
      </div>
    </aside>
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
