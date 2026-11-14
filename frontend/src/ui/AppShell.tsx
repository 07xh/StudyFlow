import {useEffect,useState,type ReactNode} from "react";
import {
  Activity,BookOpen,ChevronRight,GraduationCap,History,LayoutDashboard,
  ListChecks,PanelLeftClose,PanelLeftOpen,RefreshCw,Settings,ShieldCheck,
  Sun,Moon,Layers3
} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import {NoticeBanner} from "./NoticeBanner";
import {PageSurface} from "./PageSurface";
import "./foundation.css";

export type Page="home"|"courses"|"tasks"|"platforms"|"records"|"logs"|"settings";
const navigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"home",label:"首页",icon:LayoutDashboard},
  {id:"courses",label:"课程中心",icon:BookOpen},
  {id:"tasks",label:"学习任务",icon:ListChecks},
  {id:"platforms",label:"平台管理",icon:Layers3},
  {id:"records",label:"学习记录",icon:History},
  {id:"logs",label:"日志中心",icon:Activity},
  {id:"settings",label:"设置",icon:Settings}
];
const titles:Record<Page,string>={
  home:"统一学习助手",courses:"课程中心",tasks:"学习任务",platforms:"平台管理",
  records:"学习记录",logs:"日志中心",settings:"设置"
};
const descriptions:Record<Page,string>={
  home:"知到 + 雨课堂 · 一体化学习工具",
  courses:"查看已同步的真实课程与平台信息",
  tasks:"管理各平台原有学习任务进程",
  platforms:"每个平台的登录、连接与课程入口都在自己的卡片内",
  records:"只展示平台已经核验的学习记录",
  logs:"本机操作记录，不收集账号密码或会话内容",
  settings:"主题、布局与本机偏好"
};

interface Props {
  page:Page;onNavigate:(next:Page)=>void;dark:boolean;onThemeToggle:()=>void;
  onRefresh:()=>void;desktop:boolean;notice:string;onDismissNotice:()=>void;
  compact:boolean;children:ReactNode;
}
export function AppShell({page,onNavigate,dark,onThemeToggle,onRefresh,desktop,notice,onDismissNotice,compact,children}:Props){
  const [collapsed,setCollapsed]=useState(()=>{
    try{return window.localStorage.getItem("studyflow.nav.collapsed")==="true";}
    catch{return false;}
  });
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.collapsed",String(collapsed));}
    catch{/* Sidebar remains usable without storage. */}
  },[collapsed]);
  return <div className={["app","sf-shell",dark?"dark":"",collapsed?"sf-collapsed":"",compact?"sf-compact":""].filter(Boolean).join(" ")}>
    <aside className="sidebar" aria-label="主导航">
      <div className="brand">
        <div className="brand-icon"><GraduationCap size={25}/></div>
        <div><strong>统一学习助手</strong><small>StudyFlow</small></div>
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
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy"><ShieldCheck size={17}/> 本地优先 · 平台凭据隔离</div>
        <small>LightC-UI 2.18.3 · 视觉适配</small>
      </div>
    </aside>
    <main className="main" id="main-content">
      <header className="sf-app-header">
        <div className="sf-app-heading">
          {page==="home"&&<div className="sf-app-heading-mark"><GraduationCap size={42}/></div>}
          <div>
            <span className="eyebrow">{page==="home"?"STUDYFLOW":"学习工作空间"}</span>
            <h1>{titles[page]}</h1>
            <p className="subtitle">{descriptions[page]}</p>
          </div>
        </div>
        <div className="sf-header-actions">
          <span className={desktop?"sf-mode desktop":"sf-mode"}>{desktop?"Windows 桌面版":"浏览器预览"}</span>
          <button className="theme-button sf-header-icon" type="button" title="刷新平台连接"
            aria-label="刷新平台连接" disabled={!desktop} onClick={onRefresh}>
            <RefreshCw size={18}/>
          </button>
          <button className="theme-button sf-header-icon" type="button"
            aria-label={dark?"切换浅色主题":"切换深色主题"} title={dark?"切换浅色主题":"切换深色主题"}
            onClick={onThemeToggle}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button>
        </div>
      </header>
      <NoticeBanner message={notice} onDismiss={onDismissNotice}/>
      <PageSurface page={page}>{children}</PageSurface>
    </main>
  </div>;
}
