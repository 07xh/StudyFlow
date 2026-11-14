import {Fragment,useEffect,useState,type ReactNode} from "react";
import {BookOpen,ChevronRight,GraduationCap,LayoutDashboard,Moon,PanelLeftClose,PanelLeftOpen,Settings,ShieldCheck,Sun} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import {NoticeBanner} from "./NoticeBanner";
import {PageSurface} from "./PageSurface";
import "./foundation.css";

export type Page="home"|"courses"|"platforms"|"platform-zhidao"|"platform-yuketang"|"settings";
const navigation:{id:Page;label:string;icon:LucideIcon}[]=[
  {id:"home",label:"学习总览",icon:LayoutDashboard},
  {id:"courses",label:"课程中心",icon:BookOpen},
  {id:"platforms",label:"学习平台",icon:ShieldCheck},
  {id:"settings",label:"偏好设置",icon:Settings}
];
const titles:Record<Page,string>={
  home:"学习总览",courses:"课程中心",platforms:"学习平台",
  "platform-zhidao":"知到","platform-yuketang":"雨课堂",settings:"偏好设置"
};

interface Props {
  page:Page;onNavigate:(next:Page)=>void;dark:boolean;onThemeToggle:()=>void;
  desktop:boolean;notice:string;onDismissNotice:()=>void;compact:boolean;children:ReactNode;
}
export function AppShell({page,onNavigate,dark,onThemeToggle,desktop,notice,onDismissNotice,compact,children}:Props){
  const [platformsOpen,setPlatformsOpen]=useState(true);
  const [collapsed,setCollapsed]=useState(()=>{
    try{return window.localStorage.getItem("studyflow.nav.collapsed")==="true";}
    catch{return false;}
  });
  useEffect(()=>{
    try{window.localStorage.setItem("studyflow.nav.collapsed",String(collapsed));}
    catch{/* Sidebar still works without persisted preference. */}
  },[collapsed]);
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
        {navigation.map(item=><Fragment key={item.id}>
          <button type="button" title={item.label}
            aria-current={page===item.id?"page":undefined}
            aria-expanded={item.id==="platforms"?platformsOpen:undefined}
            className={page===item.id||(item.id==="platforms"&&page.startsWith("platform-"))?"nav active":"nav"}
            onClick={()=>{
              if(item.id==="platforms")setPlatformsOpen(current=>!current);
              onNavigate(item.id);
            }}>
            <item.icon size={19}/><span className="nav-label">{item.label}</span>
            {item.id==="platforms"
              ?<ChevronRight size={15} className={platformsOpen?"right sf-nav-expanded":"right"}/>
              :page===item.id?<ChevronRight size={15} className="right"/>:null}
          </button>
          {item.id==="platforms"&&platformsOpen&&
            <div className="sf-platform-subnav" role="group" aria-label="学习平台">
              {([
                {id:"platform-zhidao" as const,name:"知到",mark:"知"},
                {id:"platform-yuketang" as const,name:"雨课堂",mark:"雨"}
              ]).map(platform=><button key={platform.id} type="button"
                title={platform.name} aria-current={page===platform.id?"page":undefined}
                className={page===platform.id?"sf-subnav-item active":"sf-subnav-item"}
                onClick={()=>onNavigate(platform.id)}>
                <span className="sf-subnav-mark">{platform.mark}</span>
                <span className="sf-subnav-label">{platform.name}</span>
              </button>)}
            </div>}
        </Fragment>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy"><ShieldCheck size={18}/> 本地优先 · 平台凭据隔离</div>
        <small>StudyFlow · Windows 桌面端</small>
      </div>
    </aside>
    <main className="main" id="main-content">
      <header className="sf-header">
        <div><span className="eyebrow">STUDYFLOW / WORKSPACE</span>
          <h1>{titles[page]}</h1>
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
