import {useEffect,useState,type ReactNode} from "react";
import {BookOpen,ChevronDown,ChevronRight,GraduationCap,Grid2X2,Layers,LayoutDashboard,ListTodo,Moon,PanelLeftClose,PanelLeftOpen,Settings,ShieldCheck,Sun} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import type {Platform} from "../types";
import {platformInfo,platformRegistry} from "./registry";
import {NoticeBanner} from "./NoticeBanner";
import {PageSurface} from "./PageSurface";
import "./foundation.css";

export type Page="home"|"courses"|"tasks"|"platforms"|"settings"|Platform;
const navigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"home",label:"首页",icon:LayoutDashboard},
  {id:"courses",label:"课程中心",icon:BookOpen},
  {id:"tasks",label:"学习任务",icon:ListTodo},
];
const staticTitles:Record<"home"|"courses"|"tasks"|"platforms"|"settings",string>={
  home:"学习总览",courses:"课程中心",tasks:"学习任务",
  platforms:"学习平台",settings:"设置"
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
  const [platformExpanded,setPlatformExpanded]=useState(true);
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.collapsed",String(collapsed));}
    catch{/* Sidebar still works without persisted preference. */}
  },[collapsed]);
  const platformActive=page==="platforms" || platformInfo(page as Platform)!==undefined;
  const title=platformInfo(page as Platform)?.name ??
    staticTitles[page as keyof typeof staticTitles] ?? "学习平台";
  return <div className={["app","sf-shell",dark?"dark":"",collapsed?"sf-collapsed":"",compact?"sf-compact":""].filter(Boolean).join(" ")}>
    <aside className="sidebar" aria-label="主导航">
      <div className="brand">
        <div className="brand-icon"><GraduationCap size={23}/></div>
        <div><strong>学序</strong><small>StudyFlow</small></div>
      </div>
      <div className="sf-nav-head">
        <span className="section-label">工作空间</span>
        <button className="sf-nav-toggle" title={collapsed?"展开侧边栏":"折叠侧边栏"}
          type="button" aria-label={collapsed?"展开侧边栏":"折叠侧边栏"}
          aria-expanded={!collapsed} onClick={()=>setCollapsed(current=>!current)}>
          {collapsed?<PanelLeftOpen size={19}/>:<PanelLeftClose size={19}/>}
        </button>
      </div>
      <nav aria-label="学习工作空间">
        {navigation.map(item=><button key={item.id} type="button"
          title={item.label} aria-current={page===item.id?"page":undefined}
          className={page===item.id?"nav active":"nav"}
          onClick={()=>onNavigate(item.id)}>
          <item.icon size={19}/><span className="nav-label">{item.label}</span>
          {page===item.id&&<ChevronRight size={15} className="right"/>}
        </button>)}
        <div className="sf-nav-group">
          <div className="sf-nav-parent-row">
            <button type="button" title="学习平台" aria-current={page==="platforms"?"page":undefined}
              className={platformActive?"nav sf-nav-parent sf-nav-parent-active":"nav sf-nav-parent"}
              onClick={()=>{
                if(collapsed)setCollapsed(false);
                setPlatformExpanded(true);
                onNavigate("platforms");
              }}>
              <Layers size={19}/><span className="nav-label">学习平台</span>
            </button>
            <button type="button" className="sf-nav-expand"
              aria-label={platformExpanded?"收起学习平台子页面":"展开学习平台子页面"}
              aria-expanded={platformExpanded}
              onClick={()=>{if(collapsed)setCollapsed(false);setPlatformExpanded(value=>!value);}}>
              <ChevronDown size={16} className={platformExpanded?"is-open":""}/>
            </button>
          </div>
          {platformExpanded&&<div className="sf-nav-submenu" aria-label="学习平台二级页面">
            <button type="button" className={page==="platforms"?"sf-nav-subitem active":"sf-nav-subitem"}
              aria-current={page==="platforms"?"page":undefined} title="平台总览"
              onClick={()=>onNavigate("platforms")}>
              <Grid2X2 size={15}/><span className="sf-nav-sub-label">平台总览</span>
            </button>
            {platformRegistry.map(platform=><button type="button" key={platform.id}
              className={page===platform.id?"sf-nav-subitem active":"sf-nav-subitem"}
              title={platform.name} aria-current={page===platform.id?"page":undefined}
              onClick={()=>onNavigate(platform.id)}>
              <span className="sf-nav-provider-mark">{platform.mark}</span>
              <span className="sf-nav-sub-label">{platform.name}</span>
            </button>)}
          </div>}
        </div>
        <button type="button" title="设置" aria-current={page==="settings"?"page":undefined}
          className={page==="settings"?"nav active":"nav"}
          onClick={()=>onNavigate("settings")}>
          <Settings size={19}/><span className="nav-label">设置</span>
          {page==="settings"&&<ChevronRight size={15} className="right"/>}
        </button>
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy"><ShieldCheck size={18}/> 本地优先 · 平台凭据隔离</div>
        <small>StudyFlow · Windows 桌面端</small>
      </div>
    </aside>
    <main className="main" id="main-content">
      <header className="sf-header">
        <div><span className="eyebrow">STUDYFLOW / WORKSPACE</span>
          <h1>{title}</h1>
          <p className="subtitle">多学习平台统一工作空间 · 只展示真实同步数据</p>
        </div>
        <div className="sf-header-actions">
          <span className={desktop?"sf-mode desktop":"sf-mode"}>{desktop?"桌面客户端":"浏览器预览"}</span>
          <button className="theme-button" type="button" aria-label={dark?"切换浅色主题":"切换深色主题"}
            onClick={onThemeToggle}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button>
        </div>
      </header>
      <NoticeBanner message={notice} onDismiss={onDismissNotice}/>
      <PageSurface page={page}>{children}</PageSurface>
    </main>
  </div>;
}
